import { describe, it, expect, beforeEach, vi } from 'vitest'
import { suggestionsRouter } from '../suggestions'
import type { PrismaClient, CalendarEvent, Project, CategoryRule } from '@prisma/client'
import { TRPCError } from '@trpc/server'

// Mock the database module
vi.mock('database', () => ({
  prisma: {
    calendarEvent: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
    categoryRule: {
      count: vi.fn(),
    },
    timesheetEntry: {
      count: vi.fn(),
    },
  },
}))

// Mock the services
vi.mock('../../services/ai-categorization', () => ({
  getSuggestionsForEvent: vi.fn(),
}))

vi.mock('../../services/learning', () => ({
  handleCategorizationFeedback: vi.fn(),
  getDebugInfo: vi.fn(),
}))

import { getSuggestionsForEvent } from '../../services/ai-categorization'
import { handleCategorizationFeedback, getDebugInfo } from '../../services/learning'
import { prisma as mockPrisma } from 'database'

describe('suggestionsRouter', () => {
  let ctx: any

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()

    // Create mock context (authenticated user with session)
    ctx = {
      user: {
        id: 'clx5a2b3c4d5e6f7g8h9i0j5k',
        email: 'test@example.com',
      },
      session: {
        id: 'clx6a2b3c4d5e6f7g8h9i0j6k',
        userId: 'clx5a2b3c4d5e6f7g8h9i0j5k',
        expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
      },
    }
  })

  describe('suggestions.generate', () => {
    it('generates suggestions for multiple events in batch', async () => {
      const evt1Id = 'clx1a2b3c4d5e6f7g8h9i0j1k'
      const evt2Id = 'clx2a2b3c4d5e6f7g8h9i0j2k'
      const proj1Id = 'clx3a2b3c4d5e6f7g8h9i0j3k'
      const proj2Id = 'clx4a2b3c4d5e6f7g8h9i0j4k'

      const mockEvents = [
        {
          id: evt1Id,
          title: 'Engineering Standup',
          googleEventId: 'recurring_123',
          calendarId: 'primary',
          attendees: JSON.stringify([{ email: 'alice@acme.com' }]),
        },
        {
          id: evt2Id,
          title: 'Marketing Review',
          googleEventId: 'recurring_456',
          calendarId: 'work',
          attendees: JSON.stringify([{ email: 'bob@acme.com' }]),
        },
      ]

      mockPrisma.calendarEvent.findMany.mockResolvedValue(mockEvents)

      // Mock suggestions from AI service
      vi.mocked(getSuggestionsForEvent)
        .mockResolvedValueOnce([
          {
            projectId: proj1Id,
            project: { name: 'Engineering', id: proj1Id } as Project,
            confidence: 0.85,
            matchingRules: [],
            reasoning: ['Recurring event pattern'],
          },
        ])
        .mockResolvedValueOnce([
          {
            projectId: proj2Id,
            project: { name: 'Marketing', id: proj2Id } as Project,
            confidence: 0.72,
            matchingRules: [],
            reasoning: ['Title keyword: "marketing"'],
          },
        ])

      const caller = suggestionsRouter.createCaller(ctx)
      const result = await caller.generate({
        eventIds: [evt1Id, evt2Id],
      })

      // Verify Prisma queries
      expect(mockPrisma.calendarEvent.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [evt1Id, evt2Id] },
          userId: 'clx5a2b3c4d5e6f7g8h9i0j5k',
          isDeleted: false,
        },
        select: {
          id: true,
          title: true,
          googleEventId: true,
          calendarId: true,
          attendees: true,
        },
      })

      // Verify AI service was called for each event
      expect(getSuggestionsForEvent).toHaveBeenCalledTimes(2)

      // Verify result structure
      expect(result).toEqual({
        [evt1Id]: {
          projectId: proj1Id,
          projectName: 'Engineering',
          confidence: 0.85,
          reasoning: ['Recurring event pattern'],
        },
        [evt2Id]: {
          projectId: proj2Id,
          projectName: 'Marketing',
          confidence: 0.72,
          reasoning: ['Title keyword: "marketing"'],
        },
      })
    })

    it('excludes events without high-confidence suggestions from result', async () => {
      const evt1Id = 'clx7a2b3c4d5e6f7g8h9i0j7k'
      const evt2Id = 'clx8a2b3c4d5e6f7g8h9i0j8k'
      const proj1Id = 'clx9a2b3c4d5e6f7g8h9i0j9k'

      const mockEvents = [
        {
          id: evt1Id,
          title: 'High Confidence Event',
          googleEventId: 'recurring_123',
          calendarId: 'primary',
          attendees: null,
        },
        {
          id: evt2Id,
          title: 'Low Confidence Event',
          googleEventId: null,
          calendarId: 'primary',
          attendees: null,
        },
      ]

      mockPrisma.calendarEvent.findMany.mockResolvedValue(mockEvents)

      // First event has suggestion, second doesn't
      vi.mocked(getSuggestionsForEvent)
        .mockResolvedValueOnce([
          {
            projectId: proj1Id,
            project: { name: 'Engineering', id: proj1Id } as Project,
            confidence: 0.85,
            matchingRules: [],
            reasoning: ['Recurring event pattern'],
          },
        ])
        .mockResolvedValueOnce([]) // No suggestions

      const caller = suggestionsRouter.createCaller(ctx)
      const result = await caller.generate({
        eventIds: [evt1Id, evt2Id],
      })

      // Only evt1Id should be in result
      expect(result).toEqual({
        [evt1Id]: {
          projectId: proj1Id,
          projectName: 'Engineering',
          confidence: 0.85,
          reasoning: ['Recurring event pattern'],
        },
      })

      // evt2Id is excluded (no suggestion)
      expect(result[evt2Id]).toBeUndefined()
    })

    it('throws NOT_FOUND when event does not exist', async () => {
      const evt1Id = 'clxa2b3c4d5e6f7g8h9i0j0ak'
      const evt2Id = 'clxb2b3c4d5e6f7g8h9i0j0bk'

      // Return fewer events than requested
      mockPrisma.calendarEvent.findMany.mockResolvedValue([
        {
          id: evt1Id,
          title: 'Existing Event',
          googleEventId: 'recurring_123',
          calendarId: 'primary',
          attendees: null,
        },
      ])

      const caller = suggestionsRouter.createCaller(ctx)

      await expect(
        caller.generate({
          eventIds: [evt1Id, evt2Id], // evt2Id doesn't exist
        })
      ).rejects.toThrow(TRPCError)

      await expect(
        caller.generate({
          eventIds: [evt1Id, evt2Id],
        })
      ).rejects.toThrow(`Events not found or do not belong to user: ${evt2Id}`)
    })

    it('validates input: rejects empty eventIds array', async () => {
      const caller = suggestionsRouter.createCaller(ctx)

      await expect(
        caller.generate({
          eventIds: [],
        })
      ).rejects.toThrow('At least one event ID is required')
    })

    it('validates input: rejects more than 100 events', async () => {
      const caller = suggestionsRouter.createCaller(ctx)
      const tooManyEvents = Array.from({ length: 101 }, (_, i) =>
        `clx${i.toString().padStart(20, '0')}k`
      )

      await expect(
        caller.generate({
          eventIds: tooManyEvents,
        })
      ).rejects.toThrow('Maximum 100 events per batch')
    })

    it('validates input: rejects invalid CUID format', async () => {
      const caller = suggestionsRouter.createCaller(ctx)

      await expect(
        caller.generate({
          eventIds: ['invalid-id'],
        })
      ).rejects.toThrow()
    })
  })

  describe('suggestions.feedback', () => {
    it('submits feedback when user accepts suggestion', async () => {
      const evtId = 'clxc2b3c4d5e6f7g8h9i0j0ck'
      const projId = 'clxd2b3c4d5e6f7g8h9i0j0dk'
      const userId = 'clx5a2b3c4d5e6f7g8h9i0j5k'

      const mockEvent = {
        id: evtId,
        userId: userId,
        title: 'Test Event',
        isDeleted: false,
      }

      const mockProject = {
        id: projId,
        userId: userId,
        name: 'Engineering',
      }

      mockPrisma.calendarEvent.findFirst.mockResolvedValue(mockEvent)
      mockPrisma.project.findFirst.mockResolvedValue(mockProject)
      mockPrisma.categoryRule.count
        .mockResolvedValueOnce(5) // Before feedback
        .mockResolvedValueOnce(8) // After feedback (+3 new rules)

      vi.mocked(handleCategorizationFeedback).mockResolvedValue()

      const caller = suggestionsRouter.createCaller(ctx)
      const result = await caller.feedback({
        eventId: evtId,
        selectedProjectId: projId,
        suggestedProjectId: projId, // Accepted
      })

      // Verify learning service was called
      expect(handleCategorizationFeedback).toHaveBeenCalledWith(
        mockPrisma,
        evtId,
        projId,
        projId,
        userId
      )

      // Verify result
      expect(result).toEqual({
        rulesCreated: 3,
        rulesUpdated: 0,
      })
    })

    it('submits feedback when user rejects suggestion', async () => {
      const evtId = 'clxe2b3c4d5e6f7g8h9i0j0ek'
      const projCorrectId = 'clxf2b3c4d5e6f7g8h9i0j0fk'
      const projWrongId = 'clxg2b3c4d5e6f7g8h9i0j0gk'
      const userId = 'clx5a2b3c4d5e6f7g8h9i0j5k'

      const mockEvent = {
        id: evtId,
        userId: userId,
        title: 'Test Event',
        isDeleted: false,
      }

      const mockSelectedProject = {
        id: projCorrectId,
        userId: userId,
        name: 'Correct Project',
      }

      const mockSuggestedProject = {
        id: projWrongId,
        userId: userId,
        name: 'Wrong Project',
      }

      mockPrisma.calendarEvent.findFirst.mockResolvedValue(mockEvent)
      mockPrisma.project.findFirst
        .mockResolvedValueOnce(mockSelectedProject) // Selected project
        .mockResolvedValueOnce(mockSuggestedProject) // Suggested project

      mockPrisma.categoryRule.count
        .mockResolvedValueOnce(5) // Before
        .mockResolvedValueOnce(5) // After (no new rules, just updated existing)

      vi.mocked(handleCategorizationFeedback).mockResolvedValue()

      const caller = suggestionsRouter.createCaller(ctx)
      const result = await caller.feedback({
        eventId: evtId,
        selectedProjectId: projCorrectId,
        suggestedProjectId: projWrongId, // Rejected
      })

      // Verify learning service was called with rejected suggestion
      expect(handleCategorizationFeedback).toHaveBeenCalledWith(
        mockPrisma,
        evtId,
        projCorrectId,
        projWrongId,
        userId
      )

      // No new rules created (just updated)
      expect(result).toEqual({
        rulesCreated: 0,
        rulesUpdated: 1,
      })
    })

    it('submits feedback for manual categorization (no suggestion)', async () => {
      const evtId = 'clxh2b3c4d5e6f7g8h9i0j0hk'
      const projId = 'clxi2b3c4d5e6f7g8h9i0j0ik'
      const userId = 'clx5a2b3c4d5e6f7g8h9i0j5k'

      const mockEvent = {
        id: evtId,
        userId: userId,
        title: 'Test Event',
        isDeleted: false,
      }

      const mockProject = {
        id: projId,
        userId: userId,
        name: 'Engineering',
      }

      mockPrisma.calendarEvent.findFirst.mockResolvedValue(mockEvent)
      mockPrisma.project.findFirst.mockResolvedValue(mockProject)
      mockPrisma.categoryRule.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(7)

      vi.mocked(handleCategorizationFeedback).mockResolvedValue()

      const caller = suggestionsRouter.createCaller(ctx)
      const result = await caller.feedback({
        eventId: evtId,
        selectedProjectId: projId,
        // No suggestedProjectId
      })

      // Verify learning service was called with null suggestion
      expect(handleCategorizationFeedback).toHaveBeenCalledWith(
        mockPrisma,
        evtId,
        projId,
        null,
        userId
      )

      expect(result).toEqual({
        rulesCreated: 2,
        rulesUpdated: 0,
      })
    })

    it('throws NOT_FOUND when event does not exist', async () => {
      const evtMissingId = 'clxj2b3c4d5e6f7g8h9i0j0jk'
      const projId = 'clxk2b3c4d5e6f7g8h9i0j0kk'

      mockPrisma.calendarEvent.findFirst.mockResolvedValue(null)

      const caller = suggestionsRouter.createCaller(ctx)

      await expect(
        caller.feedback({
          eventId: evtMissingId,
          selectedProjectId: projId,
        })
      ).rejects.toThrow('Event not found or does not belong to user')
    })

    it('throws NOT_FOUND when selected project does not exist', async () => {
      const evtId = 'clxl2b3c4d5e6f7g8h9i0j0lk'
      const projMissingId = 'clxm2b3c4d5e6f7g8h9i0j0mk'
      const userId = 'clx5a2b3c4d5e6f7g8h9i0j5k'

      const mockEvent = {
        id: evtId,
        userId: userId,
        isDeleted: false,
      }

      mockPrisma.calendarEvent.findFirst.mockResolvedValue(mockEvent)
      mockPrisma.project.findFirst.mockResolvedValue(null) // Project not found

      const caller = suggestionsRouter.createCaller(ctx)

      await expect(
        caller.feedback({
          eventId: evtId,
          selectedProjectId: projMissingId,
        })
      ).rejects.toThrow('Project not found or does not belong to user')
    })

    it('throws NOT_FOUND when suggested project does not exist', async () => {
      const evtId = 'clxn2b3c4d5e6f7g8h9i0j0nk'
      const projSelectedId = 'clxo2b3c4d5e6f7g8h9i0j0ok'
      const projMissingId = 'clxp2b3c4d5e6f7g8h9i0j0pk'
      const userId = 'clx5a2b3c4d5e6f7g8h9i0j5k'

      const mockEvent = {
        id: evtId,
        userId: userId,
        isDeleted: false,
      }

      const mockProject = {
        id: projSelectedId,
        userId: userId,
      }

      mockPrisma.calendarEvent.findFirst.mockResolvedValue(mockEvent)
      mockPrisma.project.findFirst
        .mockResolvedValueOnce(mockProject) // Selected project found
        .mockResolvedValueOnce(null) // Suggested project not found

      const caller = suggestionsRouter.createCaller(ctx)

      await expect(
        caller.feedback({
          eventId: evtId,
          selectedProjectId: projSelectedId,
          suggestedProjectId: projMissingId,
        })
      ).rejects.toThrow('Suggested project not found or does not belong to user')
    })

    it('validates input: requires valid CUIDs', async () => {
      const caller = suggestionsRouter.createCaller(ctx)

      await expect(
        caller.feedback({
          eventId: 'invalid-id',
          selectedProjectId: 'clxq2b3c4d5e6f7g8h9i0j0qk',
        })
      ).rejects.toThrow()
    })
  })

  describe('suggestions.metrics', () => {
    it('returns comprehensive metrics for dashboard', async () => {
      const mockDebugInfo = {
        totalRules: 42,
        rulesByType: {
          RECURRING_EVENT_ID: 8,
          ATTENDEE_EMAIL: 15,
          ATTENDEE_DOMAIN: 10,
          TITLE_KEYWORD: 7,
          CALENDAR_NAME: 2,
        },
        overallAccuracy: 0.73,
        totalSuggestions: 156,
        totalMatches: 114,
        rules: [],
      }

      vi.mocked(getDebugInfo).mockResolvedValue(mockDebugInfo)

      // Mock event counts for coverage calculation
      mockPrisma.calendarEvent.count.mockResolvedValue(100) // 100 recent events
      mockPrisma.timesheetEntry.count.mockResolvedValue(82) // 82 categorized

      const caller = suggestionsRouter.createCaller(ctx)
      const result = await caller.metrics()

      // Verify debug info was fetched
      expect(getDebugInfo).toHaveBeenCalledWith(mockPrisma, 'clx5a2b3c4d5e6f7g8h9i0j5k')

      // Verify metrics calculation
      expect(result).toEqual({
        accuracyRate: 0.73,
        coverageRate: 0.82, // 82/100
        activeRulesCount: 42,
        rulesByType: {
          RECURRING_EVENT_ID: 8,
          ATTENDEE_EMAIL: 15,
          ATTENDEE_DOMAIN: 10,
          TITLE_KEYWORD: 7,
          CALENDAR_NAME: 2,
        },
        totalSuggestions: 156,
        totalMatches: 114,
      })
    })

    it('calculates coverageRate as 0 when no recent events', async () => {
      const mockDebugInfo = {
        totalRules: 0,
        rulesByType: {},
        overallAccuracy: 0,
        totalSuggestions: 0,
        totalMatches: 0,
        rules: [],
      }

      vi.mocked(getDebugInfo).mockResolvedValue(mockDebugInfo)

      mockPrisma.calendarEvent.count.mockResolvedValue(0) // No events
      mockPrisma.timesheetEntry.count.mockResolvedValue(0)

      const caller = suggestionsRouter.createCaller(ctx)
      const result = await caller.metrics()

      // Coverage should be 0 (not NaN)
      expect(result.coverageRate).toBe(0)
    })

    it('queries events from last 30 days for coverage calculation', async () => {
      const mockDebugInfo = {
        totalRules: 10,
        rulesByType: {},
        overallAccuracy: 0.8,
        totalSuggestions: 50,
        totalMatches: 40,
        rules: [],
      }

      vi.mocked(getDebugInfo).mockResolvedValue(mockDebugInfo)
      mockPrisma.calendarEvent.count.mockResolvedValue(50)
      mockPrisma.timesheetEntry.count.mockResolvedValue(40)

      const caller = suggestionsRouter.createCaller(ctx)
      await caller.metrics()

      // Verify date range query
      const eventCountCall = mockPrisma.calendarEvent.count.mock.calls[0][0]
      expect(eventCountCall.where.startTime.gte).toBeInstanceOf(Date)

      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // Check that the date is approximately 30 days ago (within 1 minute tolerance)
      const diff = Math.abs(
        eventCountCall.where.startTime.gte.getTime() - thirtyDaysAgo.getTime()
      )
      expect(diff).toBeLessThan(60000) // Less than 1 minute difference
    })

    it('handles errors gracefully', async () => {
      vi.mocked(getDebugInfo).mockRejectedValue(new Error('Database error'))

      const caller = suggestionsRouter.createCaller(ctx)

      await expect(caller.metrics()).rejects.toThrow('Failed to fetch metrics')
    })
  })
})
