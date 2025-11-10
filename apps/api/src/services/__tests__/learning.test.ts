import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  handleCategorizationFeedback,
  strengthenRules,
  penalizeIncorrectRules,
  updateRuleAccuracy,
  pruneIneffectiveRules,
  handleProjectArchival,
  getDebugInfo,
} from '../learning'
import type { CalendarEvent, CategoryRule, Project, PrismaClient } from '@prisma/client'
import type { CalendarEventInput } from '../ai-categorization'

// Mock the ai-categorization module to control pattern extraction
vi.mock('../ai-categorization', async () => {
  const actual = await vi.importActual('../ai-categorization')
  return {
    ...actual,
    extractPatternsFromEvent: vi.fn(),
  }
})

import { extractPatternsFromEvent } from '../ai-categorization'

describe('LearningService', () => {
  let prismaMock: any
  let mockEvent: CalendarEvent
  let mockEventInput: CalendarEventInput

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()

    // Create mock Prisma client
    prismaMock = {
      calendarEvent: {
        findUnique: vi.fn(),
      },
      categoryRule: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      project: {
        findUnique: vi.fn(),
      },
      $executeRaw: vi.fn(),
    }

    // Mock calendar event
    mockEvent = {
      id: 'evt_123',
      googleEventId: 'recurring_abc',
      userId: 'user_xyz',
      calendarId: 'primary',
      title: 'Engineering Standup',
      startTime: new Date('2025-11-10T09:00:00Z'),
      endTime: new Date('2025-11-10T09:30:00Z'),
      attendees: JSON.stringify([
        { email: 'alice@acme.com', responseStatus: 'accepted' },
        { email: 'bob@acme.com', responseStatus: 'accepted' },
      ]),
      location: null,
      status: 'confirmed',
      isAllDay: false,
      splitIndex: 0,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Mock event input (what extractPatternsFromEvent receives)
    mockEventInput = {
      id: mockEvent.id,
      title: mockEvent.title,
      attendees: [
        { email: 'alice@acme.com', responseStatus: 'accepted' },
        { email: 'bob@acme.com', responseStatus: 'accepted' },
      ],
      calendarId: mockEvent.calendarId,
      googleEventId: mockEvent.googleEventId,
    }
  })

  describe('handleCategorizationFeedback', () => {
    it('strengthens rules when user accepts suggestion', async () => {
      // Setup: User accepted suggestion for proj_abc
      const selectedProjectId = 'proj_abc'
      const suggestedProjectId = 'proj_abc'

      prismaMock.calendarEvent.findUnique.mockResolvedValue(mockEvent)

      // Mock pattern extraction to return some patterns
      vi.mocked(extractPatternsFromEvent).mockReturnValue([
        { ruleType: 'RECURRING_EVENT_ID', condition: 'recurring_abc' },
        { ruleType: 'ATTENDEE_EMAIL', condition: 'alice@acme.com' },
        { ruleType: 'TITLE_KEYWORD', condition: 'engineering' },
      ])

      await handleCategorizationFeedback(
        prismaMock as unknown as PrismaClient,
        'evt_123',
        selectedProjectId,
        suggestedProjectId,
        'user_xyz'
      )

      // Verify strengthenRules was called (via upsert)
      expect(prismaMock.categoryRule.upsert).toHaveBeenCalledTimes(3)

      // Should NOT penalize (suggestion was accepted)
      expect(prismaMock.categoryRule.findMany).not.toHaveBeenCalled()
    })

    it('penalizes wrong rules and strengthens correct rules when user rejects suggestion', async () => {
      // Setup: Suggestion was proj_abc, user selected proj_def
      const selectedProjectId = 'proj_def'
      const suggestedProjectId = 'proj_abc'

      prismaMock.calendarEvent.findUnique.mockResolvedValue(mockEvent)

      vi.mocked(extractPatternsFromEvent).mockReturnValue([
        { ruleType: 'RECURRING_EVENT_ID', condition: 'recurring_abc' },
        { ruleType: 'ATTENDEE_EMAIL', condition: 'alice@acme.com' },
      ])

      // Mock findMany to return rules that need penalizing
      const mockIncorrectRule: CategoryRule = {
        id: 'rule_wrong',
        userId: 'user_xyz',
        projectId: 'proj_abc',
        ruleType: 'RECURRING_EVENT_ID',
        condition: 'recurring_abc',
        confidenceScore: 0.8,
        matchCount: 5,
        totalSuggestions: 5,
        accuracy: 1.0,
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      prismaMock.categoryRule.findMany.mockResolvedValue([mockIncorrectRule])

      await handleCategorizationFeedback(
        prismaMock as unknown as PrismaClient,
        'evt_123',
        selectedProjectId,
        suggestedProjectId,
        'user_xyz'
      )

      // Verify penalization happened
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user_xyz',
          projectId: 'proj_abc',
          OR: [
            { ruleType: 'RECURRING_EVENT_ID', condition: 'recurring_abc' },
            { ruleType: 'ATTENDEE_EMAIL', condition: 'alice@acme.com' },
          ],
        },
      })

      expect(prismaMock.categoryRule.update).toHaveBeenCalled()

      // Verify strengthening happened (for correct project)
      expect(prismaMock.categoryRule.upsert).toHaveBeenCalled()
    })

    it('only strengthens rules when no suggestion was made (manual categorization)', async () => {
      // Setup: No suggestion, user manually categorized
      const selectedProjectId = 'proj_abc'
      const suggestedProjectId = null

      prismaMock.calendarEvent.findUnique.mockResolvedValue(mockEvent)

      vi.mocked(extractPatternsFromEvent).mockReturnValue([
        { ruleType: 'TITLE_KEYWORD', condition: 'standup' },
      ])

      await handleCategorizationFeedback(
        prismaMock as unknown as PrismaClient,
        'evt_123',
        selectedProjectId,
        suggestedProjectId,
        'user_xyz'
      )

      // Should NOT penalize (no suggestion to reject)
      expect(prismaMock.categoryRule.findMany).not.toHaveBeenCalled()

      // Should strengthen rules
      expect(prismaMock.categoryRule.upsert).toHaveBeenCalled()
    })

    it('handles missing event gracefully', async () => {
      prismaMock.calendarEvent.findUnique.mockResolvedValue(null)

      await handleCategorizationFeedback(
        prismaMock as unknown as PrismaClient,
        'evt_missing',
        'proj_abc',
        'proj_abc',
        'user_xyz'
      )

      // Should not crash and should not try to upsert
      expect(prismaMock.categoryRule.upsert).not.toHaveBeenCalled()
    })
  })

  describe('strengthenRules', () => {
    it('creates new rules with initial confidence 60%', async () => {
      const patterns = [
        { ruleType: 'TITLE_KEYWORD' as const, condition: 'standup' },
        { ruleType: 'ATTENDEE_EMAIL' as const, condition: 'alice@acme.com' },
      ]

      await strengthenRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_abc',
        mockEventInput
      )

      // Verify upsert was called for each pattern
      expect(prismaMock.categoryRule.upsert).toHaveBeenCalledTimes(2)

      // Verify create data has initial confidence 60%
      expect(prismaMock.categoryRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            confidenceScore: 0.60,
            matchCount: 1,
          }),
        })
      )
    })

    it('boosts existing rule confidence by 10%', async () => {
      const patterns = [
        { ruleType: 'RECURRING_EVENT_ID' as const, condition: 'recurring_abc' },
      ]

      await strengthenRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_abc',
        mockEventInput
      )

      // Verify update data increments confidence by 0.10
      expect(prismaMock.categoryRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            confidenceScore: { increment: 0.10 },
            matchCount: { increment: 1 },
          }),
        })
      )
    })

    it('caps confidence at 95%', async () => {
      const patterns = [
        { ruleType: 'RECURRING_EVENT_ID' as const, condition: 'recurring_abc' },
      ]

      await strengthenRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_abc',
        mockEventInput
      )

      // Verify raw SQL query was executed to cap at 95%
      expect(prismaMock.$executeRaw).toHaveBeenCalled()
    })

    it('processes patterns in priority order (recurring > email > domain > keyword > calendar)', async () => {
      const patterns = [
        { ruleType: 'TITLE_KEYWORD' as const, condition: 'standup' },
        { ruleType: 'CALENDAR_NAME' as const, condition: 'primary' },
        { ruleType: 'RECURRING_EVENT_ID' as const, condition: 'recurring_abc' },
        { ruleType: 'ATTENDEE_EMAIL' as const, condition: 'alice@acme.com' },
        { ruleType: 'ATTENDEE_DOMAIN' as const, condition: 'acme.com' },
      ]

      await strengthenRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_abc',
        mockEventInput
      )

      // Verify upsert calls were made in priority order
      const upsertCalls = prismaMock.categoryRule.upsert.mock.calls

      expect(upsertCalls[0][0].where.userId_ruleType_condition_projectId.ruleType).toBe('RECURRING_EVENT_ID')
      expect(upsertCalls[1][0].where.userId_ruleType_condition_projectId.ruleType).toBe('ATTENDEE_EMAIL')
      expect(upsertCalls[2][0].where.userId_ruleType_condition_projectId.ruleType).toBe('ATTENDEE_DOMAIN')
      expect(upsertCalls[3][0].where.userId_ruleType_condition_projectId.ruleType).toBe('TITLE_KEYWORD')
      expect(upsertCalls[4][0].where.userId_ruleType_condition_projectId.ruleType).toBe('CALENDAR_NAME')
    })

    it('handles empty patterns array gracefully', async () => {
      await strengthenRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        [],
        'proj_abc',
        mockEventInput
      )

      expect(prismaMock.categoryRule.upsert).not.toHaveBeenCalled()
    })
  })

  describe('penalizeIncorrectRules', () => {
    it('decreases confidence by 10% for wrong rules', async () => {
      const patterns = [
        { ruleType: 'TITLE_KEYWORD' as const, condition: 'standup' },
        { ruleType: 'ATTENDEE_EMAIL' as const, condition: 'alice@acme.com' },
      ]

      const mockIncorrectRule: CategoryRule = {
        id: 'rule_wrong',
        userId: 'user_xyz',
        projectId: 'proj_wrong',
        ruleType: 'TITLE_KEYWORD',
        condition: 'standup',
        confidenceScore: 0.7,
        matchCount: 5,
        totalSuggestions: 5,
        accuracy: 1.0,
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prismaMock.categoryRule.findMany.mockResolvedValue([mockIncorrectRule])

      await penalizeIncorrectRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_wrong'
      )

      // Verify rule confidence was decreased
      expect(prismaMock.categoryRule.update).toHaveBeenCalledWith({
        where: { id: 'rule_wrong' },
        data: expect.objectContaining({
          confidenceScore: 0.6, // 0.7 - 0.1 = 0.6
          totalSuggestions: { increment: 1 },
        }),
      })
    })

    it('floors confidence at 30%', async () => {
      const patterns = [
        { ruleType: 'TITLE_KEYWORD' as const, condition: 'meeting' },
      ]

      const mockLowConfidenceRule: CategoryRule = {
        id: 'rule_low',
        userId: 'user_xyz',
        projectId: 'proj_wrong',
        ruleType: 'TITLE_KEYWORD',
        condition: 'meeting',
        confidenceScore: 0.35, // Close to floor
        matchCount: 2,
        totalSuggestions: 5,
        accuracy: 0.4,
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prismaMock.categoryRule.findMany.mockResolvedValue([mockLowConfidenceRule])

      await penalizeIncorrectRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_wrong'
      )

      // Verify confidence was floored at 30% (0.35 - 0.10 = 0.25 → 0.30)
      expect(prismaMock.categoryRule.update).toHaveBeenCalledWith({
        where: { id: 'rule_low' },
        data: expect.objectContaining({
          confidenceScore: 0.30, // Floored at minimum
        }),
      })
    })

    it('updates accuracy calculation correctly', async () => {
      const patterns = [
        { ruleType: 'ATTENDEE_DOMAIN' as const, condition: 'acme.com' },
      ]

      const mockRule: CategoryRule = {
        id: 'rule_1',
        userId: 'user_xyz',
        projectId: 'proj_wrong',
        ruleType: 'ATTENDEE_DOMAIN',
        condition: 'acme.com',
        confidenceScore: 0.8,
        matchCount: 3, // 3 successful matches
        totalSuggestions: 4, // 4 total suggestions so far
        accuracy: 0.75, // 3/4 = 0.75
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prismaMock.categoryRule.findMany.mockResolvedValue([mockRule])

      await penalizeIncorrectRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_wrong'
      )

      // New accuracy should be: 3 / (4 + 1) = 3/5 = 0.6
      expect(prismaMock.categoryRule.update).toHaveBeenCalledWith({
        where: { id: 'rule_1' },
        data: expect.objectContaining({
          accuracy: 0.6,
          totalSuggestions: { increment: 1 },
        }),
      })
    })

    it('handles multiple incorrect rules', async () => {
      const patterns = [
        { ruleType: 'TITLE_KEYWORD' as const, condition: 'standup' },
        { ruleType: 'CALENDAR_NAME' as const, condition: 'primary' },
      ]

      const mockRule1: CategoryRule = {
        id: 'rule_1',
        userId: 'user_xyz',
        projectId: 'proj_wrong',
        ruleType: 'TITLE_KEYWORD',
        condition: 'standup',
        confidenceScore: 0.7,
        matchCount: 5,
        totalSuggestions: 5,
        accuracy: 1.0,
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mockRule2: CategoryRule = {
        id: 'rule_2',
        userId: 'user_xyz',
        projectId: 'proj_wrong',
        ruleType: 'CALENDAR_NAME',
        condition: 'primary',
        confidenceScore: 0.6,
        matchCount: 3,
        totalSuggestions: 4,
        accuracy: 0.75,
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prismaMock.categoryRule.findMany.mockResolvedValue([mockRule1, mockRule2])

      await penalizeIncorrectRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_wrong'
      )

      // Verify both rules were updated
      expect(prismaMock.categoryRule.update).toHaveBeenCalledTimes(2)
    })

    it('handles empty patterns array gracefully', async () => {
      await penalizeIncorrectRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        [],
        'proj_wrong'
      )

      expect(prismaMock.categoryRule.findMany).not.toHaveBeenCalled()
    })

    it('handles no matching rules gracefully', async () => {
      const patterns = [
        { ruleType: 'TITLE_KEYWORD' as const, condition: 'nonexistent' },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue([])

      await penalizeIncorrectRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz',
        patterns,
        'proj_wrong'
      )

      // Should not crash and should not try to update
      expect(prismaMock.categoryRule.update).not.toHaveBeenCalled()
    })
  })

  describe('updateRuleAccuracy', () => {
    it('increases accuracy and matchCount when suggestion accepted', async () => {
      const mockRule: CategoryRule = {
        id: 'rule_123',
        userId: 'user_xyz',
        projectId: 'proj_abc',
        ruleType: 'RECURRING_EVENT_ID',
        condition: 'recurring_abc',
        confidenceScore: 0.8,
        matchCount: 8, // 8 successful matches
        totalSuggestions: 10, // 10 total suggestions
        accuracy: 0.8, // 8/10 = 0.8
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prismaMock.categoryRule.findUnique.mockResolvedValue(mockRule)

      await updateRuleAccuracy(
        prismaMock as unknown as PrismaClient,
        'rule_123',
        true // Accepted
      )

      // New accuracy: (8 + 1) / (10 + 1) = 9/11 ≈ 0.818
      expect(prismaMock.categoryRule.update).toHaveBeenCalledWith({
        where: { id: 'rule_123' },
        data: expect.objectContaining({
          accuracy: expect.closeTo(0.818, 2),
          matchCount: { increment: 1 },
          totalSuggestions: { increment: 1 },
        }),
      })
    })

    it('decreases accuracy but not matchCount when suggestion rejected', async () => {
      const mockRule: CategoryRule = {
        id: 'rule_456',
        userId: 'user_xyz',
        projectId: 'proj_abc',
        ruleType: 'ATTENDEE_EMAIL',
        condition: 'alice@acme.com',
        confidenceScore: 0.7,
        matchCount: 6, // 6 successful matches
        totalSuggestions: 8, // 8 total suggestions
        accuracy: 0.75, // 6/8 = 0.75
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prismaMock.categoryRule.findUnique.mockResolvedValue(mockRule)

      await updateRuleAccuracy(
        prismaMock as unknown as PrismaClient,
        'rule_456',
        false // Rejected
      )

      // New accuracy: 6 / (8 + 1) = 6/9 ≈ 0.667
      // matchCount stays at 6 (not incremented)
      expect(prismaMock.categoryRule.update).toHaveBeenCalledWith({
        where: { id: 'rule_456' },
        data: expect.objectContaining({
          accuracy: expect.closeTo(0.667, 2),
          matchCount: 6, // Not incremented
          totalSuggestions: { increment: 1 },
        }),
      })
    })

    it('updates lastMatchedAt timestamp', async () => {
      const oldDate = new Date('2025-01-01')
      const mockRule: CategoryRule = {
        id: 'rule_789',
        userId: 'user_xyz',
        projectId: 'proj_abc',
        ruleType: 'TITLE_KEYWORD',
        condition: 'sprint',
        confidenceScore: 0.6,
        matchCount: 5,
        totalSuggestions: 10,
        accuracy: 0.5,
        lastMatchedAt: oldDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      prismaMock.categoryRule.findUnique.mockResolvedValue(mockRule)

      await updateRuleAccuracy(
        prismaMock as unknown as PrismaClient,
        'rule_789',
        true
      )

      expect(prismaMock.categoryRule.update).toHaveBeenCalledWith({
        where: { id: 'rule_789' },
        data: expect.objectContaining({
          lastMatchedAt: expect.any(Date),
        }),
      })

      // Verify lastMatchedAt is newer than oldDate
      const updateCall = prismaMock.categoryRule.update.mock.calls[0][0]
      expect(updateCall.data.lastMatchedAt.getTime()).toBeGreaterThan(oldDate.getTime())
    })

    it('handles missing rule gracefully', async () => {
      prismaMock.categoryRule.findUnique.mockResolvedValue(null)

      await updateRuleAccuracy(
        prismaMock as unknown as PrismaClient,
        'rule_nonexistent',
        true
      )

      // Should not crash and should not try to update
      expect(prismaMock.categoryRule.update).not.toHaveBeenCalled()
    })
  })

  describe('Feedback loop integration', () => {
    it('correctly handles accept -> strengthen -> boost cycle', async () => {
      // Simulate: User accepts a suggestion, rules get strengthened
      const selectedProjectId = 'proj_abc'
      const suggestedProjectId = 'proj_abc'

      prismaMock.calendarEvent.findUnique.mockResolvedValue(mockEvent)

      vi.mocked(extractPatternsFromEvent).mockReturnValue([
        { ruleType: 'RECURRING_EVENT_ID', condition: 'recurring_abc' },
      ])

      await handleCategorizationFeedback(
        prismaMock as unknown as PrismaClient,
        'evt_123',
        selectedProjectId,
        suggestedProjectId,
        'user_xyz'
      )

      // Verify strengthen was called (upsert with increment)
      expect(prismaMock.categoryRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            confidenceScore: { increment: 0.10 },
          }),
        })
      )

      // Verify NO penalization
      expect(prismaMock.categoryRule.findMany).not.toHaveBeenCalled()
    })

    it('correctly handles reject -> penalize + strengthen cycle', async () => {
      // Simulate: User rejects suggestion, picks different project
      const selectedProjectId = 'proj_correct'
      const suggestedProjectId = 'proj_wrong'

      prismaMock.calendarEvent.findUnique.mockResolvedValue(mockEvent)

      vi.mocked(extractPatternsFromEvent).mockReturnValue([
        { ruleType: 'ATTENDEE_EMAIL', condition: 'alice@acme.com' },
      ])

      const mockIncorrectRule: CategoryRule = {
        id: 'rule_wrong',
        userId: 'user_xyz',
        projectId: 'proj_wrong',
        ruleType: 'ATTENDEE_EMAIL',
        condition: 'alice@acme.com',
        confidenceScore: 0.8,
        matchCount: 5,
        totalSuggestions: 5,
        accuracy: 1.0,
        lastMatchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      prismaMock.categoryRule.findMany.mockResolvedValue([mockIncorrectRule])

      await handleCategorizationFeedback(
        prismaMock as unknown as PrismaClient,
        'evt_123',
        selectedProjectId,
        suggestedProjectId,
        'user_xyz'
      )

      // Verify penalization (find + update)
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalled()
      expect(prismaMock.categoryRule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rule_wrong' },
        })
      )

      // Verify strengthening (upsert for correct project)
      expect(prismaMock.categoryRule.upsert).toHaveBeenCalled()
    })
  })

  describe('pruneIneffectiveRules', () => {
    it('deletes rules with accuracy < 40% after 10+ suggestions', async () => {
      const mockLowAccuracyRules = [
        { id: 'rule_1' },
        { id: 'rule_2' },
        { id: 'rule_3' },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockLowAccuracyRules)
      prismaMock.categoryRule.deleteMany.mockResolvedValue({ count: 3 })
      prismaMock.$executeRaw.mockResolvedValue(BigInt(0))

      const result = await pruneIneffectiveRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // Verify findMany was called with correct conditions
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user_xyz',
          accuracy: { lt: 0.4 },
          totalSuggestions: { gte: 10 },
        },
        select: { id: true },
      })

      // Verify deleteMany was called with correct rule IDs
      expect(prismaMock.categoryRule.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['rule_1', 'rule_2', 'rule_3'] },
        },
      })

      // Verify result
      expect(result.lowAccuracy).toBe(3)
      expect(result.total).toBe(3)
    })

    it('does NOT delete rules with accuracy < 40% if totalSuggestions < 10', async () => {
      // Rules with low accuracy but insufficient suggestions should NOT be deleted
      prismaMock.categoryRule.findMany.mockResolvedValue([])
      prismaMock.categoryRule.deleteMany.mockResolvedValue({ count: 0 })
      prismaMock.$executeRaw.mockResolvedValue(BigInt(0))

      const result = await pruneIneffectiveRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // Verify the condition includes totalSuggestions >= 10
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user_xyz',
          accuracy: { lt: 0.4 },
          totalSuggestions: { gte: 10 }, // This ensures we only delete rules with 10+ suggestions
        },
        select: { id: true },
      })

      expect(result.lowAccuracy).toBe(0)
    })

    it('deletes rules for non-existent projects', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])
      prismaMock.categoryRule.deleteMany.mockResolvedValue({ count: 0 })
      prismaMock.$executeRaw.mockResolvedValue(BigInt(5))

      const result = await pruneIneffectiveRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // Verify $executeRaw was called (deletes rules for missing projects)
      expect(prismaMock.$executeRaw).toHaveBeenCalled()

      // Verify result includes deleted projects count
      expect(result.deletedProjects).toBe(5)
      expect(result.total).toBe(5)
    })

    it('returns correct counts (total, lowAccuracy, deletedProjects)', async () => {
      const mockLowAccuracyRules = [
        { id: 'rule_1' },
        { id: 'rule_2' },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockLowAccuracyRules)
      prismaMock.categoryRule.deleteMany.mockResolvedValue({ count: 2 })
      prismaMock.$executeRaw.mockResolvedValue(BigInt(3))

      const result = await pruneIneffectiveRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // Verify correct counts
      expect(result.lowAccuracy).toBe(2)
      expect(result.deletedProjects).toBe(3)
      expect(result.total).toBe(5) // 2 + 3
    })

    it('handles edge case: no rules to prune', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])
      prismaMock.categoryRule.deleteMany.mockResolvedValue({ count: 0 })
      prismaMock.$executeRaw.mockResolvedValue(BigInt(0))

      const result = await pruneIneffectiveRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      expect(result).toEqual({
        total: 0,
        lowAccuracy: 0,
        deletedProjects: 0,
      })
    })

    it('handles edge case: empty database for user', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])
      prismaMock.categoryRule.deleteMany.mockResolvedValue({ count: 0 })
      prismaMock.$executeRaw.mockResolvedValue(BigInt(0))

      const result = await pruneIneffectiveRules(
        prismaMock as unknown as PrismaClient,
        'user_nonexistent'
      )

      expect(result.total).toBe(0)
      expect(result.lowAccuracy).toBe(0)
      expect(result.deletedProjects).toBe(0)
    })

    it('handles database error gracefully', async () => {
      prismaMock.categoryRule.findMany.mockRejectedValue(
        new Error('Database connection failed')
      )

      const result = await pruneIneffectiveRules(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // Should return zero counts on error
      expect(result).toEqual({
        total: 0,
        lowAccuracy: 0,
        deletedProjects: 0,
      })
    })
  })

  describe('handleProjectArchival', () => {
    it('verifies project exists before processing', async () => {
      const mockProject: Partial<Project> = {
        id: 'proj_abc',
        name: 'Test Project',
        isArchived: true,
      }

      prismaMock.project.findUnique.mockResolvedValue(mockProject)
      prismaMock.categoryRule.count.mockResolvedValue(5)

      await handleProjectArchival(
        prismaMock as unknown as PrismaClient,
        'proj_abc'
      )

      // Verify project was fetched
      expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
        where: { id: 'proj_abc' },
        select: { id: true, isArchived: true, name: true },
      })
    })

    it('checks that project is actually archived', async () => {
      const mockProject: Partial<Project> = {
        id: 'proj_abc',
        name: 'Test Project',
        isArchived: false, // Not archived
      }

      prismaMock.project.findUnique.mockResolvedValue(mockProject)
      prismaMock.categoryRule.count.mockResolvedValue(0)

      await handleProjectArchival(
        prismaMock as unknown as PrismaClient,
        'proj_abc'
      )

      // Should NOT count rules if project is not archived
      expect(prismaMock.categoryRule.count).not.toHaveBeenCalled()
    })

    it('counts rules associated with the archived project', async () => {
      const mockProject: Partial<Project> = {
        id: 'proj_abc',
        name: 'Test Project',
        isArchived: true,
      }

      prismaMock.project.findUnique.mockResolvedValue(mockProject)
      prismaMock.categoryRule.count.mockResolvedValue(8)

      await handleProjectArchival(
        prismaMock as unknown as PrismaClient,
        'proj_abc'
      )

      // Verify count was called
      expect(prismaMock.categoryRule.count).toHaveBeenCalledWith({
        where: { projectId: 'proj_abc' },
      })
    })

    it('does NOT delete or modify rules on archival', async () => {
      const mockProject: Partial<Project> = {
        id: 'proj_abc',
        name: 'Test Project',
        isArchived: true,
      }

      prismaMock.project.findUnique.mockResolvedValue(mockProject)
      prismaMock.categoryRule.count.mockResolvedValue(5)

      await handleProjectArchival(
        prismaMock as unknown as PrismaClient,
        'proj_abc'
      )

      // Verify no delete, update, or deleteMany was called
      expect(prismaMock.categoryRule.deleteMany).not.toHaveBeenCalled()
      expect(prismaMock.categoryRule.update).not.toHaveBeenCalled()
    })

    it('handles missing project gracefully', async () => {
      prismaMock.project.findUnique.mockResolvedValue(null)

      // Should not crash
      await handleProjectArchival(
        prismaMock as unknown as PrismaClient,
        'proj_missing'
      )

      // Should not attempt to count rules
      expect(prismaMock.categoryRule.count).not.toHaveBeenCalled()
    })

    it('handles non-archived project gracefully', async () => {
      const mockProject: Partial<Project> = {
        id: 'proj_abc',
        name: 'Test Project',
        isArchived: false,
      }

      prismaMock.project.findUnique.mockResolvedValue(mockProject)

      // Should not crash
      await handleProjectArchival(
        prismaMock as unknown as PrismaClient,
        'proj_abc'
      )

      // Should not attempt to count rules
      expect(prismaMock.categoryRule.count).not.toHaveBeenCalled()
    })

    it('handles database error gracefully', async () => {
      prismaMock.project.findUnique.mockRejectedValue(
        new Error('Database error')
      )

      // Should not crash
      await handleProjectArchival(
        prismaMock as unknown as PrismaClient,
        'proj_abc'
      )

      expect(prismaMock.project.findUnique).toHaveBeenCalled()
    })
  })

  describe('getDebugInfo', () => {
    it('returns correct aggregate statistics', async () => {
      const mockRules = [
        {
          id: 'rule_1',
          userId: 'user_xyz',
          projectId: 'proj_abc',
          ruleType: 'RECURRING_EVENT_ID',
          condition: 'recurring_123',
          confidenceScore: 0.9,
          accuracy: 0.9,
          matchCount: 9,
          totalSuggestions: 10,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            name: 'Project A',
            isArchived: false,
          },
        },
        {
          id: 'rule_2',
          userId: 'user_xyz',
          projectId: 'proj_def',
          ruleType: 'ATTENDEE_EMAIL',
          condition: 'alice@acme.com',
          confidenceScore: 0.8,
          accuracy: 0.8,
          matchCount: 8,
          totalSuggestions: 10,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            name: 'Project B',
            isArchived: false,
          },
        },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockRules)

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      expect(result.totalRules).toBe(2)
      expect(result.rulesByType['RECURRING_EVENT_ID']).toBe(1)
      expect(result.rulesByType['ATTENDEE_EMAIL']).toBe(1)
      expect(result.totalSuggestions).toBe(20)
      expect(result.totalMatches).toBe(17)
    })

    it('calculates overallAccuracy correctly (totalMatches / totalSuggestions)', async () => {
      const mockRules = [
        {
          id: 'rule_1',
          userId: 'user_xyz',
          projectId: 'proj_abc',
          ruleType: 'TITLE_KEYWORD',
          condition: 'standup',
          confidenceScore: 0.8,
          accuracy: 0.8,
          matchCount: 8,
          totalSuggestions: 10,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            name: 'Project A',
            isArchived: false,
          },
        },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockRules)

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // 8 matches / 10 suggestions = 0.8
      expect(result.overallAccuracy).toBe(0.8)
    })

    it('formats rules with all required fields including projectArchived', async () => {
      const mockRules = [
        {
          id: 'rule_1',
          userId: 'user_xyz',
          projectId: 'proj_abc',
          ruleType: 'RECURRING_EVENT_ID',
          condition: 'recurring_123',
          confidenceScore: 0.85,
          accuracy: 0.85,
          matchCount: 5,
          totalSuggestions: 6,
          lastMatchedAt: new Date('2025-11-09'),
          createdAt: new Date('2025-10-01'),
          updatedAt: new Date(),
          project: {
            name: 'Project A',
            isArchived: true,
          },
        },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockRules)

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      const formattedRule = result.rules[0]
      expect(formattedRule).toMatchObject({
        id: 'rule_1',
        ruleType: 'RECURRING_EVENT_ID',
        condition: 'recurring_123',
        projectId: 'proj_abc',
        projectName: 'Project A',
        projectArchived: true,
        confidenceScore: 0.85,
        accuracy: 0.85,
        matchCount: 5,
        totalSuggestions: 6,
      })
      expect(formattedRule.lastMatchedAt).toBeDefined()
      expect(formattedRule.createdAt).toBeDefined()
    })

    it('orders rules by accuracy DESC, totalSuggestions DESC', async () => {
      const mockRules = [
        {
          id: 'rule_1',
          userId: 'user_xyz',
          projectId: 'proj_abc',
          ruleType: 'RECURRING_EVENT_ID',
          condition: 'recurring_123',
          confidenceScore: 0.9,
          accuracy: 0.9, // Higher accuracy
          matchCount: 9,
          totalSuggestions: 10,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            name: 'Project A',
            isArchived: false,
          },
        },
        {
          id: 'rule_2',
          userId: 'user_xyz',
          projectId: 'proj_def',
          ruleType: 'ATTENDEE_EMAIL',
          condition: 'alice@acme.com',
          confidenceScore: 0.8,
          accuracy: 0.7, // Lower accuracy
          matchCount: 7,
          totalSuggestions: 10,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            name: 'Project B',
            isArchived: false,
          },
        },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockRules)

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // Verify findMany was called with correct orderBy
      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { accuracy: 'desc' },
            { totalSuggestions: 'desc' },
          ],
        })
      )

      // Rules should be ordered by accuracy DESC
      expect(result.rules[0].accuracy).toBeGreaterThanOrEqual(result.rules[1].accuracy)
    })

    it('handles empty rule sets correctly', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      expect(result.totalRules).toBe(0)
      expect(result.rulesByType).toEqual({})
      expect(result.overallAccuracy).toBe(0)
      expect(result.totalSuggestions).toBe(0)
      expect(result.totalMatches).toBe(0)
      expect(result.rules).toEqual([])
    })

    it('includes archived project information in rules', async () => {
      const mockRules = [
        {
          id: 'rule_1',
          userId: 'user_xyz',
          projectId: 'proj_archived',
          ruleType: 'CALENDAR_NAME',
          condition: 'primary',
          confidenceScore: 0.7,
          accuracy: 0.7,
          matchCount: 3,
          totalSuggestions: 4,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            name: 'Archived Project',
            isArchived: true,
          },
        },
        {
          id: 'rule_2',
          userId: 'user_xyz',
          projectId: 'proj_active',
          ruleType: 'ATTENDEE_DOMAIN',
          condition: 'acme.com',
          confidenceScore: 0.75,
          accuracy: 0.75,
          matchCount: 6,
          totalSuggestions: 8,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: {
            name: 'Active Project',
            isArchived: false,
          },
        },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockRules)

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      const archivedRule = result.rules.find(r => r.projectArchived === true)
      const activeRule = result.rules.find(r => r.projectArchived === false)

      expect(archivedRule).toBeDefined()
      expect(archivedRule?.projectName).toBe('Archived Project')
      expect(activeRule).toBeDefined()
      expect(activeRule?.projectName).toBe('Active Project')
    })

    it('calculates overallAccuracy as 0 when no suggestions exist', async () => {
      const mockRules = []

      prismaMock.categoryRule.findMany.mockResolvedValue(mockRules)

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // Should handle division by zero
      expect(result.overallAccuracy).toBe(0)
    })

    it('counts rules by type correctly with multiple rule types', async () => {
      const mockRules = [
        {
          id: 'rule_1',
          userId: 'user_xyz',
          projectId: 'proj_abc',
          ruleType: 'RECURRING_EVENT_ID',
          condition: 'recurring_123',
          confidenceScore: 0.8,
          accuracy: 0.8,
          matchCount: 4,
          totalSuggestions: 5,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: { name: 'Project A', isArchived: false },
        },
        {
          id: 'rule_2',
          userId: 'user_xyz',
          projectId: 'proj_abc',
          ruleType: 'RECURRING_EVENT_ID',
          condition: 'recurring_456',
          confidenceScore: 0.85,
          accuracy: 0.85,
          matchCount: 5,
          totalSuggestions: 6,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: { name: 'Project A', isArchived: false },
        },
        {
          id: 'rule_3',
          userId: 'user_xyz',
          projectId: 'proj_def',
          ruleType: 'ATTENDEE_EMAIL',
          condition: 'alice@acme.com',
          confidenceScore: 0.9,
          accuracy: 0.9,
          matchCount: 3,
          totalSuggestions: 3,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: { name: 'Project B', isArchived: false },
        },
        {
          id: 'rule_4',
          userId: 'user_xyz',
          projectId: 'proj_ghi',
          ruleType: 'TITLE_KEYWORD',
          condition: 'sprint',
          confidenceScore: 0.75,
          accuracy: 0.75,
          matchCount: 6,
          totalSuggestions: 8,
          lastMatchedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          project: { name: 'Project C', isArchived: false },
        },
      ]

      prismaMock.categoryRule.findMany.mockResolvedValue(mockRules)

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      expect(result.rulesByType['RECURRING_EVENT_ID']).toBe(2)
      expect(result.rulesByType['ATTENDEE_EMAIL']).toBe(1)
      expect(result.rulesByType['TITLE_KEYWORD']).toBe(1)
    })

    it('handles database error gracefully', async () => {
      prismaMock.categoryRule.findMany.mockRejectedValue(
        new Error('Database connection failed')
      )

      const result = await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      // Should return default error response
      expect(result).toEqual({
        totalRules: 0,
        rulesByType: {},
        overallAccuracy: 0,
        totalSuggestions: 0,
        totalMatches: 0,
        rules: [],
      })
    })

    it('includes correct userId in findMany query', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])

      await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_specific'
      )

      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user_specific' },
        })
      )
    })

    it('includes project relationship in query', async () => {
      prismaMock.categoryRule.findMany.mockResolvedValue([])

      await getDebugInfo(
        prismaMock as unknown as PrismaClient,
        'user_xyz'
      )

      expect(prismaMock.categoryRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            project: {
              select: { name: true, isArchived: true },
            },
          },
        })
      )
    })
  })
})
