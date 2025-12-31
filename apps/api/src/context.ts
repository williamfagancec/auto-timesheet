import { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { auth } from './auth/better-auth.js'
import type { Session, User } from 'better-auth/types'

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  let user: User | null = null
  let session: Session | null = null

  try {
    // Better-Auth automatically validates session from cookies
    const authResult = await auth.api.getSession({
      headers: req.headers as any,
    })

    if (authResult) {
      session = authResult.session
      user = authResult.user
    }
  } catch (error) {
    console.error('[Context] Session validation failed:', error)
    // Continue with null user/session - not all routes require authentication
  }

  return {
    req,
    res,
    user,
    session,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
