import { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { lucia } from './auth/lucia'
import type { User, Session } from 'lucia'
import { getValidAccessToken } from './auth/token-refresh'

// Track in-flight token refresh operations to prevent concurrent refreshes for the same user
const tokenRefreshPromises = new Map<string, Promise<void>>()

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  // Extract session ID from cookie
  const sessionId = req.cookies[lucia.sessionCookieName] ?? null

  console.log('[Context] Session cookie check:', {
    url: req.url,
    cookieName: lucia.sessionCookieName,
    sessionId: sessionId ? sessionId.substring(0, 20) + '...' : null,
    allCookies: Object.keys(req.cookies),
  })

  let user: User | null = null
  let session: Session | null = null

  if (sessionId) {
    const result = await lucia.validateSession(sessionId)
    session = result.session
    user = result.user

    console.log('[Context] Session validation result:', {
      hasSession: !!session,
      hasUser: !!user,
      userId: user?.id,
    })

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
            await getValidAccessToken(userId, 'google')
            console.log(`[Context] Successfully refreshed tokens for user ${userId}`)
          } catch (error: any) {
            // Only log errors that aren't "no connection" (expected for users without calendar)
            if (!error.message?.includes('CALENDAR_NOT_CONNECTED')) {
              console.error(`[Context] Token refresh failed for user ${userId}:`, error.message || error)
            }
            // Re-throw to propagate error to all waiting callers
            throw error
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
      refreshPromise.catch(() => {
        // Swallow errors here since they're already logged above
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
