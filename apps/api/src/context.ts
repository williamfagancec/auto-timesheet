import { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { lucia } from './auth/lucia'
import type { User, Session } from 'lucia'
import { getValidAccessToken, isTokenExpired } from './auth/token-refresh'
import { prisma } from 'database'

// Track in-flight token refresh operations to prevent concurrent refreshes for the same user
const tokenRefreshPromises = new Map<string, Promise<void>>()

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  // Extract session ID from cookie
  const sessionId = req.cookies[lucia.sessionCookieName] ?? null

  // console.log('[Context] Session cookie check:', {
  //   url: req.url,
  //   cookieName: lucia.sessionCookieName,
  //   sessionId: sessionId ? sessionId.substring(0, 20) + '...' : null,
  //   allCookies: Object.keys(req.cookies),
  // })

  let user: User | null = null
  let session: Session | null = null

  if (sessionId) {
    const result = await lucia.validateSession(sessionId)
    session = result.session
    user = result.user

    // console.log('[Context] Session validation result:', {
    //   hasSession: !!session,
    //   hasUser: !!user,
    //   userId: user?.id,
    // })

    // Create new session cookie if session was refreshed
    if (session && session.fresh) {
      const sessionCookie = lucia.createSessionCookie(session.id)
      res.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    }

    // Create blank session cookie if session is invalid
    if (!session) {
      const sessionCookie = lucia.createBlankSessionCookie()
      res.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    }

    // Proactively refresh Google OAuth tokens if user is authenticated
    // This ensures tokens are always fresh when user accesses the app
    // Runs in background - won't block requests if refresh fails
    if (user && session) {
      const userId = user.id

      // Check if there's already a refresh in progress for this user
      let refreshPromise = tokenRefreshPromises.get(userId)

      if (!refreshPromise) {
        // No refresh in progress - create a new one
        refreshPromise = (async () => {
          try {
            // Check if token actually needs refresh before attempting
            // This prevents unnecessary refresh immediately after OAuth login
            const connection = await prisma.calendarConnection.findUnique({
              where: {
                userId_provider: { userId, provider: 'google' },
              },
              select: { expiresAt: true },
            })

            // Skip refresh if no connection (user hasn't connected calendar yet)
            if (!connection) {
              // console.log(`[Context] Skipping token refresh for user ${userId}: no calendar connection`)
              return
            }

            // Skip refresh if token is fresh (expires more than 10 minutes from now)
            // This avoids refreshing tokens that were just issued during OAuth
            if (connection.expiresAt && !isTokenExpired(connection.expiresAt, 10)) {
              // console.log(`[Context] Skipping token refresh for user ${userId}: token is still fresh (expires at ${connection.expiresAt.toISOString()})`)
              return
            }

            // Token is expired or expiring soon - refresh it
            // console.log(`[Context] Token needs refresh for user ${userId}, refreshing...`)
            await getValidAccessToken(userId, 'google')
            // console.log(`[Context] Successfully refreshed tokens for user ${userId}`)
          } catch (error: any) {
            // Catch and log ALL errors - never let background refresh break the request
            // This includes CALENDAR_NOT_CONNECTED, token decryption errors, network errors, etc.
            console.error(`[Context] Token refresh failed for user ${userId}:`, error.message || error)
            // Don't re-throw - this is a background operation that should never affect the response
          } finally {
            // Clean up the promise from the map so future requests can start a new refresh
            tokenRefreshPromises.delete(userId)
          }
        })()

        // Store the promise so concurrent requests for the same user can reuse it
        tokenRefreshPromises.set(userId, refreshPromise)
      }

      // Fire and forget - don't block the request
      // Multiple concurrent requests will share the same refresh promise
      // All errors are caught above, so this should never reject
      refreshPromise.catch(() => {
        // Extra safety net - swallow any errors that somehow escape
        // This prevents unhandled promise rejections
      })
    }
  }

  return {
    req,
    res,
    user,
    session,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
