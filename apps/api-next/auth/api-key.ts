import { timingSafeEqual } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { prisma } from 'database'

/**
 * Validates team API key from Authorization header
 * Expected format: "Bearer <key>"
 *
 * Uses constant-time comparison to prevent timing attacks
 *
 * @param authHeader - The Authorization header value
 * @returns true if API key is valid, false otherwise
 */
export function validateApiKey(authHeader: string | undefined): boolean {
  if (!authHeader) {
    return false
  }

  const expectedKey = process.env.TEAM_API_KEY
  if (!expectedKey) {
    console.error('[API Key] TEAM_API_KEY not configured in environment variables')
    return false
  }

  // Extract Bearer token - case insensitive match for "Bearer"
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    console.warn('[API Key] Invalid Authorization header format (expected: Bearer <key>)')
    return false
  }

  const providedKey = match[1]

  // Constant-time comparison to prevent timing attacks
  try {
    return timingSafeEqual(
        Buffer.from(providedKey, 'utf8'),
        Buffer.from(expectedKey, 'utf8')
    )
  } catch {
    // timingSafeEqual throws if lengths differ
    return false
    }
  }

/**
 * Fetches user from database and validates existence
 *
 * @param userId - The user ID to fetch
 * @returns User object matching Lucia User type
 * @throws TRPCError with code UNAUTHORIZED if user not found
 */
export async function getUserForApiKey(userId: string) {
  // Validate user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      rmUserId: true,
    },
  })

  if (!user) {
    console.warn(`[API Key] User not found: ${userId}`)
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Invalid user ID',
    })
  }

  return user
}
