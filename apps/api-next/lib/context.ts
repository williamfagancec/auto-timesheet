import { NextRequest } from 'next/server'
import { lucia } from '../auth/lucia'
import type { User, Session } from 'lucia'
import { getValidAccessToken, isTokenExpired } from '../auth/token-refresh'
import { prisma } from 'database'

// Track in-flight token refresh operations (prevent concurrent refreshes for same user)
const tokenRefreshPromises = new Map<string, Promise<void>>()

export async function createContext(req: NextRequest) {
  let user: User | null = null
  let session: Session | null = null
  let authMethod: 'session' | 'api_key' | null = null

  // Check for API key authentication (priority)
  const authHeader = req.headers.get('authorization')
  const userIdHeader = req.headers.get('x-user-id')

  if (authHeader && userIdHeader) {
    // Validate API key format
    const apiKey = authHeader.replace('Bearer ', '')
    const expectedKey = process.env.API_KEY

    if (expectedKey && apiKey === expectedKey) {
      try {
        // Look up user by ID
        const apiUser = await prisma.user.findUnique({
          where: { id: userIdHeader },
          select: {
            id: true,
            email: true,
            name: true,
            rmUserId: true,
          },
        })

        if (apiUser) {
          user = apiUser as User
          authMethod = 'api_key'
          console.log(`[Context] API key auth successful for user ${apiUser.email}`)
        }
      } catch (error) {
        console.error('[Context] API key validation failed:', error)
      }
    }
  }

  // Fall back to session-based authentication
  if (!user) {
    const cookies = req.cookies
    const sessionId = cookies.get(lucia.sessionCookieName)?.value ?? null

    if (sessionId) {
      const result = await lucia.validateSession(sessionId)
      session = result.session
      user = result.user
      authMethod = 'session'

      // Proactive token refresh (background, non-blocking) - same logic as Fastify
      if (user && session) {
        const userId = user.id
        let refreshPromise = tokenRefreshPromises.get(userId)

        if (!refreshPromise) {
          refreshPromise = (async () => {
            try {
              // Check if user has a calendar connection
              const connection = await prisma.calendarConnection.findUnique({
                where: { userId_provider: { userId, provider: 'google' } },
                select: { expiresAt: true },
              })

              if (!connection) return

              // Only refresh if token expires within 10 minutes
              if (connection.expiresAt && !isTokenExpired(connection.expiresAt, 10)) return

              console.log(`[Context] Proactively refreshing token for user ${userId}`)
              await getValidAccessToken(userId, 'google')
            } catch (error: any) {
              console.error(`[Context] Token refresh failed for user ${userId}:`, error.message)
            } finally {
              tokenRefreshPromises.delete(userId)
            }
          })()

          tokenRefreshPromises.set(userId, refreshPromise)
        }

        // Fire and forget - don't block request
        refreshPromise.catch(() => {})
      }
    }
  }

  return {
    req,
    user,
    session,
    authMethod,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
