import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  logSuggestion,
  getSuggestionMetrics,
  getProblematicPatterns,
  type SuggestionOutcome,
} from '../analytics'
import type { PrismaClient, CategoryRule, Project } from '@prisma/client'

describe('AnalyticsService', () => {
  let prismaMock: any
  const userId = 'user_123'

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock Prisma client
    prismaMock = {
      suggestionLog: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      categoryRule: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      calendarEvent: {
        count: vi.fn(),
      },
      timesheetEntry: {
        count: vi.fn(),
      },
    }
  })

  describe('logSuggestion', () => {
    it('should successfully log a suggestion', async () => {
      prismaMock.suggestionLog.create.mockResolvedValue({
        id: 'log_123',
        userId,
        eventId: 'evt_123',
        suggestedProjectId: 'proj_abc',
        confidence: 0.85,
        outcome: 'ACCEPTED',
        createdAt: new Date(),
      })

      await logSuggestion(
        prismaMock as PrismaClient,
        userId,
        'evt_123',
        'proj_abc',
        0.85,
        'ACCEPTED'
      )

      expect(prismaMock.suggestionLog.create).toHaveBeenCalledWith({
        data: {
          userId,
          eventId: 'evt_123',
          suggestedProjectId: 'proj_abc',
          confidence: 0.85,
          outcome: 'ACCEPTED',
        },
      })
    })

    it('should not throw error if logging fails', async () => {
      prismaMock.suggestionLog.create.mockRejectedValue(
        new Error('Database connection failed')
      )

      // Should not throw - graceful degradation
      await expect(
        logSuggestion(
          prismaMock as PrismaClient,
          userId,
          'evt_123',
          'proj_abc',
          0.85,
          'ACCEPTED'
        )
      ).resolves.toBeUndefined()
    })

    it('should log all outcome types correctly', async () => {
      const outcomes: SuggestionOutcome[] = ['ACCEPTED', 'REJECTED', 'IGNORED']

      for (const outcome of outcomes) {
        prismaMock.suggestionLog.create.mockResolvedValue({})

        await logSuggestion(
          prismaMock as PrismaClient,
          userId,
          'evt_123',
          'proj_abc',
          0.75,
          outcome
        )

        expect(prismaMock.suggestionLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ outcome }),
          })
        )
      }
    })
  })

  describe('getSuggestionMetrics', () => {
    it('should calculate metrics correctly for 30-day range', async () => {
      // Mock suggestion logs for the past 30 days
      const mockSuggestions = [
        { confidence: 0.80, outcome: 'ACCEPTED' },
        { confidence: 0.70, outcome: 'ACCEPTED' },
        { confidence: 0.65, outcome: 'REJECTED' },
        { confidence: 0.90, outcome: 'ACCEPTED' },
        { confidence: 0.55, outcome: 'IGNORED' },
      ]

      prismaMock.suggestionLog.findMany.mockResolvedValue(mockSuggestions)

      // Mock coverage calculation
      prismaMock.calendarEvent.count.mockResolvedValue(100) // 100 total events
      prismaMock.timesheetEntry.count.mockResolvedValue(82) // 82 categorized

      // Mock new rules this week
      prismaMock.categoryRule.count.mockResolvedValue(3)

      const metrics = await getSuggestionMetrics(
        prismaMock as PrismaClient,
        userId,
        '30d'
      )

      // Acceptance rate: 3 accepted / 5 total = 0.6
      expect(metrics.acceptanceRate).toBe(0.6)

      // Average confidence: (0.80 + 0.70 + 0.65 + 0.90 + 0.55) / 5 = 0.72
      expect(metrics.averageConfidence).toBe(0.72)

      // Coverage rate: 82 / 100 = 0.82
      expect(metrics.coverageRate).toBe(0.82)

      // New rules this week
      expect(metrics.newRulesThisWeek).toBe(3)

      // Total suggestions
      expect(metrics.totalSuggestions).toBe(5)

      // Time range label
      expect(metrics.timeRange).toBe('Last 30 days')
    })

    it('should calculate metrics correctly for 7-day range', async () => {
      const mockSuggestions = [
        { confidence: 0.85, outcome: 'ACCEPTED' },
        { confidence: 0.90, outcome: 'ACCEPTED' },
      ]

      prismaMock.suggestionLog.findMany.mockResolvedValue(mockSuggestions)
      prismaMock.calendarEvent.count.mockResolvedValue(50)
      prismaMock.timesheetEntry.count.mockResolvedValue(45)
      prismaMock.categoryRule.count.mockResolvedValue(2)

      const metrics = await getSuggestionMetrics(
        prismaMock as PrismaClient,
        userId,
        '7d'
      )

      expect(metrics.acceptanceRate).toBe(1.0) // 2/2
      expect(metrics.averageConfidence).toBe(0.875) // (0.85 + 0.90) / 2
      expect(metrics.coverageRate).toBe(0.9) // 45/50
      expect(metrics.timeRange).toBe('Last 7 days')
    })

    it('should handle empty suggestion logs', async () => {
      prismaMock.suggestionLog.findMany.mockResolvedValue([])
      prismaMock.calendarEvent.count.mockResolvedValue(50)
      prismaMock.timesheetEntry.count.mockResolvedValue(0)
      prismaMock.categoryRule.count.mockResolvedValue(0)

      const metrics = await getSuggestionMetrics(
        prismaMock as PrismaClient,
        userId,
        '30d'
      )

      expect(metrics.acceptanceRate).toBe(0)
      expect(metrics.averageConfidence).toBe(0)
      expect(metrics.coverageRate).toBe(0)
      expect(metrics.newRulesThisWeek).toBe(0)
      expect(metrics.totalSuggestions).toBe(0)
    })

    it('should handle zero events gracefully', async () => {
      prismaMock.suggestionLog.findMany.mockResolvedValue([])
      prismaMock.calendarEvent.count.mockResolvedValue(0) // No events
      prismaMock.timesheetEntry.count.mockResolvedValue(0)
      prismaMock.categoryRule.count.mockResolvedValue(0)

      const metrics = await getSuggestionMetrics(
        prismaMock as PrismaClient,
        userId,
        '30d'
      )

      // Coverage rate should be 0 when there are no events (not divide by zero)
      expect(metrics.coverageRate).toBe(0)
    })

    it('should return zero values on database error', async () => {
      prismaMock.suggestionLog.findMany.mockRejectedValue(
        new Error('Database error')
      )

      const metrics = await getSuggestionMetrics(
        prismaMock as PrismaClient,
        userId,
        '30d'
      )

      // Should return graceful defaults
      expect(metrics.acceptanceRate).toBe(0)
      expect(metrics.averageConfidence).toBe(0)
      expect(metrics.coverageRate).toBe(0)
      expect(metrics.newRulesThisWeek).toBe(0)
      expect(metrics.totalSuggestions).toBe(0)
      expect(metrics.timeRange).toBe('Last 30 days')
    })

    it('should query correct time range in database', async () => {
      prismaMock.suggestionLog.findMany.mockResolvedValue([])
      prismaMock.calendarEvent.count.mockResolvedValue(0)
      prismaMock.timesheetEntry.count.mockResolvedValue(0)
      prismaMock.categoryRule.count.mockResolvedValue(0)

      await getSuggestionMetrics(prismaMock as PrismaClient, userId, '7d')

      // Check that findMany was called with date filter
      expect(prismaMock.suggestionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId,
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        })
      )
    })
  })

  describe('getProblematicPatterns', () => {
    it('should identify rules with low accuracy', async () => {
      const mockProblematicRules: Array<CategoryRule & { project: Project }> = [
        {
          id: 'rule_1',
          userId,
          ruleType: 'TITLE_KEYWORD',
          condition: 'mtg',
          projectId: 'proj_abc',
          confidenceScore: 0.6,
          matchCount: 2,
          totalSuggestions: 10,
          accuracy: 0.2, // 20% accuracy - very poor
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            id: 'proj_abc',
            userId,
            name: 'Engineering',
            isArchived: false,
            useCount: 10,
            lastUsedAt: new Date(),
            createdAt: new Date(),
          },
        },
        {
          id: 'rule_2',
          userId,
          ruleType: 'ATTENDEE_DOMAIN',
          condition: 'contractor.com',
          projectId: 'proj_def',
          confidenceScore: 0.5,
          matchCount: 1,
          totalSuggestions: 5,
          accuracy: 0.2, // 20% accuracy
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            id: 'proj_def',
            userId,
            name: 'Consulting',
            isArchived: false,
            useCount: 5,
            lastUsedAt: new Date(),
            createdAt: new Date(),
          },
        },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockProblematicRules)

      const patterns = await getProblematicPatterns(
        prismaMock as PrismaClient,
        userId
      )

      expect(patterns).toHaveLength(2)

      // Check first pattern
      expect(patterns[0]).toMatchObject({
        ruleId: 'rule_1',
        ruleType: 'TITLE_KEYWORD',
        condition: 'mtg',
        projectName: 'Engineering',
        accuracy: 0.2,
        totalSuggestions: 10,
        acceptedCount: 2,
      })

      // Should have a recommendation
      expect(patterns[0].recommendation).toBeTruthy()
      expect(typeof patterns[0].recommendation).toBe('string')
    })

    it('should filter rules by minimum suggestions threshold', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])

      await getProblematicPatterns(prismaMock as PrismaClient, userId)

      // Should query with totalSuggestions >= 3
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            totalSuggestions: { gte: 3 },
          }),
        })
      )
    })

    it('should filter rules by accuracy threshold', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])

      await getProblematicPatterns(prismaMock as PrismaClient, userId)

      // Should query with accuracy < 0.5 (50%)
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accuracy: { lt: 0.5 },
          }),
        })
      )
    })

    it('should return empty array if no problematic patterns found', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])

      const patterns = await getProblematicPatterns(
        prismaMock as PrismaClient,
        userId
      )

      expect(patterns).toEqual([])
    })

    it('should return empty array on database error', async () => {
      prismaMock.categoryRule.findMany.mockRejectedValue(
        new Error('Database error')
      )

      const patterns = await getProblematicPatterns(
        prismaMock as PrismaClient,
        userId
      )

      // Should return empty array on error (graceful degradation)
      expect(patterns).toEqual([])
    })

    it('should generate appropriate recommendations for different rule types', async () => {
      const mockRules: Array<CategoryRule & { project: Project }> = [
        {
          id: 'rule_1',
          userId,
          ruleType: 'TITLE_KEYWORD',
          condition: 'mtg', // Short keyword
          projectId: 'proj_1',
          confidenceScore: 0.5,
          matchCount: 1,
          totalSuggestions: 3,
          accuracy: 0.33,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            id: 'proj_1',
            userId,
            name: 'Engineering',
            isArchived: false,
            useCount: 1,
            lastUsedAt: new Date(),
            createdAt: new Date(),
          },
        },
        {
          id: 'rule_2',
          userId,
          ruleType: 'ATTENDEE_EMAIL',
          condition: 'john@acme.com',
          projectId: 'proj_2',
          confidenceScore: 0.5,
          matchCount: 1,
          totalSuggestions: 4,
          accuracy: 0.25,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            id: 'proj_2',
            userId,
            name: 'Marketing',
            isArchived: false,
            useCount: 1,
            lastUsedAt: new Date(),
            createdAt: new Date(),
          },
        },
        {
          id: 'rule_3',
          userId,
          ruleType: 'RECURRING_EVENT_ID',
          condition: 'recurring_xyz',
          projectId: 'proj_3',
          confidenceScore: 0.5,
          matchCount: 1,
          totalSuggestions: 3,
          accuracy: 0.33,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            id: 'proj_3',
            userId,
            name: 'Sales',
            isArchived: false,
            useCount: 1,
            lastUsedAt: new Date(),
            createdAt: new Date(),
          },
        },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockRules)

      const patterns = await getProblematicPatterns(
        prismaMock as PrismaClient,
        userId
      )

      // Check that each rule type gets a specific recommendation
      expect(patterns[0].recommendation).toContain('too generic') // Short keyword
      expect(patterns[1].recommendation).toContain('work across multiple projects') // Email
      expect(patterns[2].recommendation).toContain('categorized differently') // Recurring event
    })

    it('should sort patterns by accuracy (ascending) and totalSuggestions (descending)', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])

      await getProblematicPatterns(prismaMock as PrismaClient, userId)

      // Check orderBy clause
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ accuracy: 'asc' }, { totalSuggestions: 'desc' }],
        })
      )
    })

    it('should include project relation in query', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])

      await getProblematicPatterns(prismaMock as PrismaClient, userId)

      // Should include project in the query
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { project: true },
        })
      )
    })
  })
})
