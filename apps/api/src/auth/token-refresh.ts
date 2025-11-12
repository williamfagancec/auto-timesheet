import { prisma } from 'database'
import { encrypt, decrypt } from './encryption.js'
import { google } from './google.js'

/**
 * Check if an access token is expired or will expire soon
 */
export function isTokenExpired(expiresAt: Date, bufferMinutes: number = 5): boolean {
  const now = new Date()
  const expiryWithBuffer = new Date(expiresAt.getTime() - bufferMinutes * 60 * 1000)
  return now >= expiryWithBuffer
}

/**
 * Refresh Google OAuth access token using refresh token
 * Returns new access token and expiry time
 */
export async function refreshGoogleToken(refreshToken: string): Promise<{
  accessToken: string
  expiresAt: Date
  refreshToken?:string
}> {
  // Validate refresh token format before attempting refresh
  if (!refreshToken || refreshToken.trim().length === 0) {
    console.error('[Token Refresh] Invalid refresh token format: empty or null')
    throw new Error('INVALID_REFRESH_TOKEN_FORMAT: Refresh token is empty')
  }

  console.log('[Token Refresh] Attempting refresh', {
    tokenLength: refreshToken.length,
    tokenPrefix: refreshToken.substring(0, 10) + '...',
  })

  try {
    const tokens = await google.refreshAccessToken(refreshToken)

    console.log('[Token Refresh] Success', {
      hasNewRefreshToken: !!tokens.refreshToken(),
      expiresAt: tokens.accessTokenExpiresAt(),
    })

    return {
      accessToken: tokens.accessToken(),
      expiresAt: tokens.accessTokenExpiresAt(),
      ...(tokens.refreshToken() && { refreshToken: tokens.refreshToken() }),
    }
  } catch (error) {
    console.error('[Token Refresh] Failed', {
      errorName: error instanceof Error ? error.name : 'Unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    })

    // Parse error for specific issues
    if (error instanceof Error) {
      const errorMsg = error.message.toLowerCase()

      // Check for Arctic-specific error patterns
      if (errorMsg.includes('missing') && errorMsg.includes('refresh_token')) {
        throw new Error('ARCTIC_VALIDATION_ERROR: Arctic library validation failed - refresh token may be malformed')
      }

      if (errorMsg.includes('invalid_grant') || errorMsg.includes('token has been expired or revoked')) {
        throw new Error('REFRESH_TOKEN_REVOKED: User needs to re-authenticate with Google')
      }

      if (errorMsg.includes('invalid_client')) {
        throw new Error('OAUTH_CONFIG_ERROR: Invalid Google OAuth credentials (check CLIENT_ID/SECRET)')
      }

      if (errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('econnrefused')) {
        throw new Error('NETWORK_ERROR: Failed to connect to Google OAuth servers')
      }
    }

    throw new Error('REFRESH_FAILED: ' + (error instanceof Error ? error.message : String(error)))
  }
}

/**
 * Get valid access token for a user's calendar connection
 * Automatically refreshes if expired
 */
export async function getValidAccessToken(
  userId: string,
  provider: string = 'google'
): Promise<string> {
  // Get calendar connection
  const connection = await prisma.calendarConnection.findUnique({
    where: {
      userId_provider: { userId, provider },
    },
  })

  if (!connection) {
    throw new Error('CALENDAR_NOT_CONNECTED: No calendar connection found for user. Please connect your Google Calendar first.')
  }

  console.log('[Token Validation]', {
    userId,
    hasRefreshToken: !!connection.refreshToken,
    tokenExpired: connection.expiresAt ? isTokenExpired(connection.expiresAt) : true,
    expiresAt: connection.expiresAt?.toISOString(),
  })

  // Decrypt access token
  let accessToken: string
  try {
    accessToken = decrypt(connection.accessToken)
  } catch (decryptError) {
    console.error('[Token Decryption] Failed for access token:', decryptError)
    throw new Error('TOKEN_DECRYPTION_ERROR: Failed to decrypt stored access token. User needs to re-authenticate.')
  }

  // Check if token needs refresh (if expiresAt is null, assume it's expired)
  if (!connection.expiresAt || isTokenExpired(connection.expiresAt)) {
    if (!connection.refreshToken) {
      console.error('[Token Refresh] No refresh token available', {
        userId,
        connectionCreatedAt: connection.createdAt?.toISOString(),
      })
      throw new Error('NO_REFRESH_TOKEN: No refresh token available. User needs to re-authenticate with Google.')
    }

    console.log(`[Token Refresh] Token expired for user ${userId}, refreshing...`)

    // Decrypt refresh token and get new access token
    let decryptedRefreshToken: string
    try {
      decryptedRefreshToken = decrypt(connection.refreshToken)

      // Validate decrypted token format
      if (!decryptedRefreshToken || decryptedRefreshToken.trim().length === 0) {
        throw new Error('Decrypted refresh token is empty')
      }

      console.log('[Token Refresh] Decrypted refresh token', {
        length: decryptedRefreshToken.length,
      })
    } catch (decryptError) {
      console.error('[Token Decryption] Failed for refresh token:', decryptError)
      throw new Error('TOKEN_DECRYPTION_ERROR: Failed to decrypt refresh token. User needs to re-authenticate.')
    }

    try {
      const newTokens = await refreshGoogleToken(decryptedRefreshToken)

      // Update database with new tokens
      await prisma.calendarConnection.update({
        where: {
          userId_provider: { userId, provider },
        },
        data: {
          accessToken: encrypt(newTokens.accessToken),
          expiresAt: newTokens.expiresAt,
          // Update refresh token if Google rotates it
          ...(newTokens.refreshToken && {
            refreshToken: encrypt(newTokens.refreshToken)
        }),
        },
      })

      console.log(`Successfully refreshed token for user ${userId}`)
      accessToken = newTokens.accessToken
    } catch (refreshError) {
      console.error('Token refresh failed for user', userId, refreshError)

      // If refresh token is revoked or invalid, invalidate all user sessions
      // This forces the user to log in again to re-authenticate with Google
      if (refreshError instanceof Error &&
          refreshError.message.includes('REFRESH_TOKEN_REVOKED')) {
        console.log(`Invalidating all sessions for user ${userId} due to revoked refresh token`)
        try {
          await prisma.session.deleteMany({ where: { userId } })
        } catch (sessionDeleteError) {
          console.error('Failed to delete sessions:', sessionDeleteError)
        }
        throw new Error('SESSION_INVALIDATED: Your Google Calendar connection has expired. Please log in again.')
      }

      // Re-throw with the specific error from refreshGoogleToken
      throw refreshError
    }
  }

  return accessToken
}

/**
 * Refresh all expired tokens (can be run as a scheduled job)
 */
export async function refreshAllExpiredTokens(): Promise<{
  refreshed: number
  failed: number
}> {
  const now = new Date()
  let refreshed = 0
  let failed = 0

  // Find all connections with expired or soon-to-expire tokens
  const connections = await prisma.calendarConnection.findMany({
    where: {
      expiresAt: {
        lte: new Date(now.getTime() + 10 * 60 * 1000), // Expire in next 10 minutes
      },
      refreshToken: {
        not: null,
      },
    },
  })

  console.log(`Found ${connections.length} tokens to refresh`)

  // Refresh tokens in parallel with limited concurrency
  const BATCH_SIZE = 10
  for (let i = 0; i < connections.length; i += BATCH_SIZE) {
    const batch = connections.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(async (connection) => {
  
      const decryptedRefreshToken = decrypt(connection.refreshToken!)
      const newTokens = await refreshGoogleToken(decryptedRefreshToken)

      await prisma.calendarConnection.update({
        where: {
          userId_provider: {
            userId: connection.userId,
            provider: connection.provider,
          },
        },
        data: {
          accessToken: encrypt(newTokens.accessToken),
          expiresAt: newTokens.expiresAt,
          // Update refresh token if Google rotates it
          ...(newTokens.refreshToken && {
            refreshToken: encrypt(newTokens.refreshToken)
          }),
        },
      })

    }))

    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        refreshed++
        console.log(`Refreshed token for user ${batch[idx].userId}`)
      } else {
        failed++
        console.error(`Failed to refresh token for user ${batch[idx].userId}:`, result.reason)
      }
    })
  }

  return { refreshed, failed }
}
