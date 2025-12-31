import { TRPCError } from '@trpc/server'

interface RateLimitWindow {
  userId: string
  count: number
  resetAt: Date
}

// In-memory rate limit cache (per serverless instance)
const rateLimitCache = new Map<string, RateLimitWindow>()

const RATE_LIMIT_MAX = 200 // requests per window
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute

/**
 * Per-user rate limiting (serverless-friendly)
 * Each serverless instance maintains its own cache
 */
export function checkRateLimit(userId: string): void {
  const now = new Date()
  const cacheKey = userId

  let window = rateLimitCache.get(cacheKey)

  if (!window || window.resetAt < now) {
    // Create new window
    window = {
      userId,
      count: 0,
      resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW),
    }
    rateLimitCache.set(cacheKey, window)
  }

  // Clean up expired entries periodically
  function cleanupExpiredWindows() {
    const now = new Date()
    for (const [key, window] of rateLimitCache.entries())
      if (window.resetAt < now) {
        rateLimitCache.delete(key)
      }
    }

  // Run cleanup every 5 minutes
  if (typeof setInterval !== 'undefined') {
    setInterval(cleanupExpiredWindows, 5 * 60 * 1000) // 5 mins
  }

  window.count++

  if (window.count > RATE_LIMIT_MAX) {
    const resetInSeconds = Math.ceil((window.resetAt.getTime() - now.getTime()) / 1000)
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Rate limit exceeded. Try again in ${resetInSeconds} seconds`,
    })
  }
}
