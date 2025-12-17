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
  return timingSafeEqual(
    Buffer.from(providedKey),
    Buffer.from(expectedKey)
  )
}

/**
 * Timing-safe string comparison
 * Prevents attackers from using timing differences to guess the API key
 *
 * @param a - First buffer to compare
 * @param b - Second buffer to compare
 * @returns true if buffers are equal, false otherwise
 */
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  // If lengths don't match, still do comparison to maintain constant time
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }
  return result === 0
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
