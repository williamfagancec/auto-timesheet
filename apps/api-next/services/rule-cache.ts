import type { PrismaClient, CategoryRule, Project } from '@prisma/client'
import { redisClient } from 'shared'
import { CACHE_CONFIG } from 'config'

type CacheEntry = {
  rules: (CategoryRule & { project: Project })[]
  expiresAt: number
}

export type CacheMetrics = {
  hits: number
  misses: number
  hitRate: number
  redisHits: number
  fallbackHits: number
  total: number
}

/**
 * Multi-layer rule cache with Redis (distributed) and in-memory fallback
 *
 * Cache hierarchy:
 * 1. Redis (primary, multi-instance safe)
 * 2. In-memory Map (fallback when Redis unavailable)
 * 3. Database (cache miss)
 */
export class RuleCache {
  private fallbackStore: Map<string, CacheEntry>
  private ttlMs: number
  private ttlSeconds: number

  // Metrics tracking
  private hits = 0
  private misses = 0
  private redisHits = 0
  private fallbackHits = 0

  constructor(ttlMs = 5 * 60 * 1000) {
    this.fallbackStore = new Map()
    this.ttlMs = ttlMs
    this.ttlSeconds = Math.floor(ttlMs / 1000)
  }

  /**
   * Fetch rules for user from cache (Redis → in-memory) or database
   */
  async getRulesForUser(
    userId: string,
    prisma: PrismaClient
  ): Promise<(CategoryRule & { project: Project })[]> {
    const cacheKey = `${CACHE_CONFIG.keyPrefixes.rules}:${userId}`

    // Try Redis first (distributed cache)
    if (redisClient.isConnected()) {
      const cached = await redisClient.get<(CategoryRule & { project: Project })[]>(cacheKey)
      if (cached) {
        const hydrated = cached.map(rule => ({
          ...rule,
          lastMatchedAt: rule.lastMatchedAt ? new Date(rule.lastMatchedAt) : null,
        }))
        this.hits++
        this.redisHits++
        if (CACHE_CONFIG.logCacheHits) {
          console.log(`[RuleCache] Redis HIT for user: ${userId}`)
        }
        return hydrated
      }
    }

    // Try in-memory fallback
    const now = Date.now()
    const entry = this.fallbackStore.get(userId)
    if (entry && entry.expiresAt > now) {
      this.hits++
      this.fallbackHits++
      if (CACHE_CONFIG.logCacheHits) {
        console.log(`[RuleCache] Fallback HIT for user: ${userId}`)
      }
      return entry.rules
    }

    // Cache miss - load from database
    this.misses++
    if (CACHE_CONFIG.logCacheHits) {
      console.log(`[RuleCache] MISS for user: ${userId}, loading from database`)
    }

    const rules = await prisma.categoryRule.findMany({
      where: {
        userId,
        project: { isArchived: false },
      },
      include: { project: true },
    }) as (CategoryRule & { project: Project })[]

    // Store in Redis (primary cache)
    const redisStored = await redisClient.set(
      cacheKey,
      rules,
      this.ttlSeconds
    )

    if (redisStored && CACHE_CONFIG.logCacheHits) {
      console.log(`[RuleCache] Stored in Redis for user: ${userId}`)
    }

    // Store in fallback (always, for resilience)
    this.fallbackStore.set(userId, {
      rules,
      expiresAt: now + this.ttlMs,
    })

    return rules
  }

  /**
   * Invalidate cache for a specific user (clears both Redis and in-memory)
   */
  async invalidate(userId: string): Promise<void> {
    const cacheKey = `${CACHE_CONFIG.keyPrefixes.rules}:${userId}`

    // Remove from Redis
    const redisDeleted = await redisClient.del(cacheKey)

    // Remove from fallback
    this.fallbackStore.delete(userId)

    console.log(`[RuleCache] Invalidated cache for user: ${userId} (redis: ${redisDeleted})`)
  }

  /**
   * Get cache performance metrics
   */
  getMetrics(): CacheMetrics {
    const total = this.hits + this.misses
    const hitRate = total > 0 ? this.hits / total : 0

    return {
      hits: this.hits,
      misses: this.misses,
      hitRate,
      redisHits: this.redisHits,
      fallbackHits: this.fallbackHits,
      total,
    }
  }

  /**
   * Reset metrics (useful for testing or periodic resets)
   */
  resetMetrics(): void {
    this.hits = 0
    this.misses = 0
    this.redisHits = 0
    this.fallbackHits = 0
  }
}

export default RuleCache
