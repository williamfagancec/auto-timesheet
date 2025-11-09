import { describe, it, expect } from 'vitest'
import SuggestionEngine, { PatternExtractor, ConfidenceCalculator } from '../suggestion-engine'
import { RuleCache } from '../rule-cache'
import type { CalendarEventInput } from '../ai-categorization'
import type { CategoryRule, Project } from '@prisma/client'

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

describe('SuggestionEngine performance (batch vs individual)', () => {
  it('batch processing should be faster than individual fetches', async () => {
    const userId = 'user-perf'
    const N = 200

    // Create synthetic events
    const events: CalendarEventInput[] = Array.from({ length: N }, (_, i) => ({
      id: `evt_${i}`,
      title: `Event ${i}`,
      attendees: [],
      calendarId: 'primary',
      googleEventId: null,
    }))

    // Mock Prisma: batch findMany (events) is slightly slower but single call
    const prismaMock: any = {
      calendarEvent: {
        findMany: async (_opts: any) => {
          await delay(10) // simulate DB latency for batch fetch
          // return rows with minimal fields used by engine
          return events.map((e) => ({ ...e }))
        },
        findUnique: async ({ where }: any) => {
          // simulate per-id fetch latency
          await delay(2)
          const id = where.id
          const ev = events.find((x) => x.id === id)
          return ev ? { ...ev } : null
        },
      },
      categoryRule: {
        findMany: async (_opts: any) => {
          await delay(10) // simulate DB latency for rules
          const project: Project = {
            id: 'proj_perf',
            name: 'Perf Project',
            userId,
            isArchived: false,
            useCount: 0,
            lastUsedAt: new Date(),
            createdAt: new Date(),
          }
          const rules: (CategoryRule & { project: Project })[] = events.map((_, i) => ({
            id: `rule_${i}`,
            userId,
            projectId: project.id,
            ruleType: 'TITLE_KEYWORD',
            condition: `event ${i}`,
            confidenceScore: 0.7,
            matchCount: 0,
            totalSuggestions: 0,
            accuracy: 0,
            lastMatchedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            project,
          }))
          return rules
        },
      },
    }

    // Extractor that matches nothing expensive (fast)
    const extractor: PatternExtractor = {
      extract: (e) => {
        // simple keyword extraction: split title into words
        const words = (e.title || '').toLowerCase().split(/\s+/).slice(0, 1)
        return words.map((w) => ({ ruleType: 'TITLE_KEYWORD', condition: w }))
      },
    }

    const calculator: ConfidenceCalculator = {
      calculate: () => 0.8,
    }

    const ruleCache = new RuleCache(5 * 60 * 1000)
    const engine = new SuggestionEngine({ extractor, calculator, prisma: prismaMock, ruleCache })

    const ids = events.map((e) => e.id)

    // Batch run
    const t0 = process.hrtime.bigint()
    const batchResult = await engine.generateBatchSuggestions(ids, userId)
    const t1 = process.hrtime.bigint()

    const batchMs = Number(t1 - t0) / 1e6

    // Individual run: fetch per-id then call generateSuggestion
    // Ensure cache is invalidated so both runs load rules similarly
    ruleCache.invalidate(userId)

    const t2 = process.hrtime.bigint()
    for (const id of ids) {
      const rec = await prismaMock.calendarEvent.findUnique({ where: { id } })
      if (rec) {
        // call generateSuggestion using the event object
        await engine.generateSuggestion(rec as CalendarEventInput, userId)
      }
    }
    const t3 = process.hrtime.bigint()

    const individualMs = Number(t3 - t2) / 1e6

    // Sanity checks
    expect(batchResult.size).toBe(N)
    expect(batchMs).toBeGreaterThanOrEqual(0)
    expect(individualMs).toBeGreaterThanOrEqual(0)

    // Expect batch to be faster than individual (because individual does N DB calls)
    expect(batchMs).toBeLessThan(individualMs)
  }, 20000)
})
