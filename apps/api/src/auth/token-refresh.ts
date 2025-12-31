import { auth } from './better-auth.js'
import { prisma } from 'database'

/**
 * Get valid Google OAuth access token for a user
 * Better-Auth automatically refreshes the token if it's expired
 *
 * @param userId - User ID
 * @param provider - OAuth provider (default: 'google')
 * @returns Decrypted access token ready to use with Google API
 */
export async function getValidAccessToken(
  userId: string,
  provider: string = 'google'
): Promise<string> {
  try {
    // Better-Auth handles token refresh automatically
    // It decrypts the stored token, checks expiry, and refreshes if needed
    const result = await auth.api.getAccessToken({
      body: {
        providerId: provider,
        userId,
      },
    })

    if (!result || !result.accessToken) {
      // No access token found - user needs to connect their calendar
      throw new Error('CALENDAR_NOT_CONNECTED: No Google Calendar connection found. Please connect your Google Calendar.')
    }

    return result.accessToken
  } catch (error) {
    console.error('[Token Refresh] Failed to get access token:', error)

    // Check if user even has an OAuth account
    const account = await prisma.account.findFirst({
      where: {
        userId,
        providerId: provider,
      },
    })

    if (!account) {
      throw new Error('CALENDAR_NOT_CONNECTED: No Google Calendar connection found. Please connect your Google Calendar.')
    }

    // If we have an account but getAccessToken failed, it's likely a refresh error
    throw new Error('TOKEN_REFRESH_FAILED: Failed to refresh Google Calendar access. Please reconnect your Google Calendar.')
  }
}

// Note: The following functions have been removed as Better-Auth handles them internally:
// - isTokenExpired() - Better-Auth checks token expiry automatically
// - refreshGoogleToken() - Better-Auth handles OAuth token refresh
// - refreshAllExpiredTokens() - Better-Auth refreshes tokens on-demand when needed
