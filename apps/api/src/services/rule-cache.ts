import type { PrismaClient, CategoryRule, Project } from '@prisma/client'

type CacheEntry = {
  rules: (CategoryRule & { project: Project })[]
  expiresAt: number
}

/**
 * Simple in-memory rule cache with TTL. Not distributed — intended for single-process workers.
 */
export class RuleCache {
  private store: Map<string, CacheEntry>
  private ttlMs: number

  constructor(ttlMs = 5 * 60 * 1000) {
    this.store = new Map()
    this.ttlMs = ttlMs
  }

  // Fetch rules for user from cache or database
  async getRulesForUser(userId: string, prisma: PrismaClient): Promise<(CategoryRule & { project: Project })[]> {
    const now = Date.now()
    const entry = this.store.get(userId)
    if (entry && entry.expiresAt > now) {
      return entry.rules
    }

    // Load from DB and cache
    const rules = await prisma.categoryRule.findMany({ where: { userId }, include: { project: true } }) as (CategoryRule & { project: Project })[]
    this.store.set(userId, { rules, expiresAt: now + this.ttlMs })
    return rules
  }

  invalidate(userId: string) {
    this.store.delete(userId)
  }
}

export default RuleCache
