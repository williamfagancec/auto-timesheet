import { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { lucia } from './auth/lucia'
import type { User, Session } from 'lucia'
import { getValidAccessToken } from './auth/token-refresh'

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
      getValidAccessToken(userId, 'google')
        .then(() => {
          console.log(`[Context] Successfully refreshed tokens for user ${userId}`)
        })
        .catch((error) => {
          // Only log errors that aren't "no connection" (expected for users without calendar)
          if (!error.message?.includes('CALENDAR_NOT_CONNECTED')) {
            console.error(`[Context] Token refresh failed for user ${userId}:`, error.message || error)
          }
          // Don't block the request if token refresh fails
          // Token will be refreshed on next calendar API call
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
