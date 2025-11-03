import { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { lucia } from './auth/lucia'
import type { User, Session } from 'lucia'

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  // Extract session ID from cookie
  const sessionId = req.cookies[lucia.sessionCookieName] ?? null

  let user: User | null = null
  let session: Session | null = null

  if (sessionId) {
    const result = await lucia.validateSession(sessionId)
    session = result.session
    user = result.user

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
  }

  return {
    req,
    res,
    user,
    session,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
