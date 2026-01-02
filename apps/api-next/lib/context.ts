import { NextRequest } from 'next/server'
import { auth } from '../auth/better-auth'
import type { Session, User } from 'better-auth/types'

export async function createContext(req: NextRequest) {
  let user: User | null = null
  let session: Session | null = null

  try {
    // Better-Auth automatically validates session from cookies
    // Convert Next.js headers to format Better-Auth expects
    const headers: Record<string, string> = {}
    req.headers.forEach((value, key) => {
      headers[key] = value
    })

    const authResult = await auth.api.getSession({
      headers: headers as any,
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
    user,
    session,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
