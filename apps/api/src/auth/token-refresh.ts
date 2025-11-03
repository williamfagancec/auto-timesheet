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
}> {
  try {
    const tokens = await google.refreshAccessToken(refreshToken)

    return {
      accessToken: tokens.accessToken(),
      expiresAt: tokens.accessTokenExpiresAt(),
    }
  } catch (error) {
    console.error('Failed to refresh Google token:', error)
    throw new Error('Failed to refresh access token')
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
    throw new Error('Calendar connection not found')
  }

  // Decrypt access token
  let accessToken = decrypt(connection.accessToken)

  // Check if token needs refresh (if expiresAt is null, assume it's expired)
  if (!connection.expiresAt || isTokenExpired(connection.expiresAt)) {
    if (!connection.refreshToken) {
      throw new Error('No refresh token available - user needs to re-authenticate')
    }

    console.log(`Refreshing expired access token for user ${userId}`)

    // Decrypt refresh token and get new access token
    const decryptedRefreshToken = decrypt(connection.refreshToken)
    const newTokens = await refreshGoogleToken(decryptedRefreshToken)

    // Update database with new tokens
    await prisma.calendarConnection.update({
      where: {
        userId_provider: { userId, provider },
      },
      data: {
        accessToken: encrypt(newTokens.accessToken),
        expiresAt: newTokens.expiresAt,
      },
    })

    accessToken = newTokens.accessToken
  }

  return accessToken
}

/**
 * Refresh all expired tokens (can be run as a scheduled job)
 */
export async function refreshExpiredTokens(): Promise<{
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

  // Refresh each token
  for (const connection of connections) {
    try {
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
        },
      })

      refreshed++
      console.log(`Refreshed token for user ${connection.userId}`)
    } catch (error) {
      failed++
      console.error(`Failed to refresh token for user ${connection.userId}:`, error)
    }
  }

  return { refreshed, failed }
}
