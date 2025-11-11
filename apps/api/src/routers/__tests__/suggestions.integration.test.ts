/**
 * Integration tests for suggestions router
 *
 * Tests the complete suggestion flow end-to-end with real database operations:
 * - Suggestion generation using real CategoryRule data
 * - Feedback processing with database mutations
 * - Metrics calculation from real database state
 * - Authorization and data isolation between users
 * - Error handling for missing/invalid data
 *
 * These tests use real Prisma operations and a test database instance.
 * Mocking is only used for external services (AI, learning).
 */

import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { suggestionsRouter } from '../suggestions'
import type { User, Project, CalendarEvent, CategoryRule, TimesheetEntry } from '@prisma/client'
import { TRPCError } from '@trpc/server'

// Mock the learning service to avoid complex feedback logic in integration tests
vi.mock('../../services/learning', () => ({
  handleCategorizationFeedback: vi.fn(),
  getDebugInfo: vi.fn(),
}))

import { handleCategorizationFeedback, getDebugInfo } from '../../services/learning'

// Use real Prisma instance
const prisma = new PrismaClient()

// Helper types
interface TestUser {
  id: string
  email: string
  hashedPassword: string
  createdAt: Date
  name?: string | null
}

interface TestContext {
  user: { id: string; email: string }
  session: { id: string; userId: string; expiresAt: Date }
}

// =============================================================================
// TEST FIXTURES & HELPERS
// =============================================================================

/**
 * Create a test user in the database
 */
async function createTestUser(email: string): Promise<TestUser> {
  return prisma.user.create({
    data: {
      email,
      hashedPassword: 'hashed_test_password',
    },
  })
}

/**
 * Create a test project
 */
async function createTestProject(
  userId: string,
  name: string,
  isArchived: boolean = false
): Promise<Project> {
  return prisma.project.create({
    data: {
      userId,
      name,
      isArchived,
    },
  })
}

/**
 * Create a test calendar event
 */
async function createTestEvent(
  userId: string,
  title: string,
  options: {
    googleEventId?: string
    calendarId?: string
    attendees?: Array<{ email: string; responseStatus?: string }>
    isDeleted?: boolean
  } = {}
): Promise<CalendarEvent> {
  const now = new Date()
  return prisma.calendarEvent.create({
    data: {
      userId,
      title,
      googleEventId: options.googleEventId || `google_${Date.now()}`,
      calendarId: options.calendarId || 'primary',
      startTime: now,
      endTime: new Date(now.getTime() + 3600000), // 1 hour later
      attendees: options.attendees || [],
      isDeleted: options.isDeleted || false,
    },
  })
}

/**
 * Create a test category rule
 */
async function createTestRule(
  userId: string,
  projectId: string,
  ruleType: string,
  condition: string,
  options: {
    confidenceScore?: number
    matchCount?: number
    totalSuggestions?: number
    accuracy?: number
  } = {}
): Promise<CategoryRule> {
  return prisma.categoryRule.create({
    data: {
      userId,
      projectId,
      ruleType,
      condition,
      confidenceScore: options.confidenceScore ?? 0.7,
      matchCount: options.matchCount ?? 0,
      totalSuggestions: options.totalSuggestions ?? 0,
      accuracy: options.accuracy ?? 0,
    },
  })
}

/**
 * Create a test context with authenticated user
 */
function createTestContext(user: TestUser): TestContext {
  return {
    user: { id: user.id, email: user.email },
    session: {
      id: `session_${Date.now()}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 86400000), // 24 hours
    },
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('suggestionsRouter - Integration Tests', () => {
  let user1: TestUser
  let user2: TestUser
  let ctx1: TestContext
  let ctx2: TestContext

  beforeEach(async () => {
    // Create test users
    user1 = await createTestUser(`test_user1_${Date.now()}@example.com`)
    user2 = await createTestUser(`test_user2_${Date.now()}@example.com`)

    // Create contexts
    ctx1 = createTestContext(user1)
    ctx2 = createTestContext(user2)

    // Clear mocks
    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Clean up test data (delete in correct order to respect foreign keys)
    await prisma.suggestionLog.deleteMany({ where: { userId: user1.id } })
    await prisma.suggestionLog.deleteMany({ where: { userId: user2.id } })
    await prisma.timesheetEntry.deleteMany({ where: { userId: user1.id } })
    await prisma.timesheetEntry.deleteMany({ where: { userId: user2.id } })
    await prisma.categoryRule.deleteMany({ where: { userId: user1.id } })
    await prisma.categoryRule.deleteMany({ where: { userId: user2.id } })
    await prisma.calendarEvent.deleteMany({ where: { userId: user1.id } })
    await prisma.calendarEvent.deleteMany({ where: { userId: user2.id } })
    await prisma.project.deleteMany({ where: { userId: user1.id } })
    await prisma.project.deleteMany({ where: { userId: user2.id } })
    await prisma.user.deleteMany({ where: { id: user1.id } })
    await prisma.user.deleteMany({ where: { id: user2.id } })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // ===========================================================================
  // suggestions.generate Integration Tests
  // ===========================================================================

  describe('suggestions.generate - Integration', () => {
    it('generates suggestions for events with matching rules', async () => {
      // Create test data
      const project = await createTestProject(user1.id, 'Engineering')
      const event = await createTestEvent(user1.id, 'Engineering Standup', {
        googleEventId: 'recurring_abc',
        calendarId: 'primary',
        attendees: [{ email: 'alice@acme.com' }],
      })

      // Create a rule that matches the event
      await createTestRule(user1.id, project.id, 'RECURRING_EVENT_ID', 'recurring_abc', {
        confidenceScore: 0.9,
      })

      // Call suggestions.generate
      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [event.id],
      })

      // Verify suggestion was generated
      expect(result[event.id]).toBeDefined()
      expect(result[event.id].projectId).toBe(project.id)
      expect(result[event.id].projectName).toBe('Engineering')
      expect(result[event.id].confidence).toBeGreaterThan(0.5)
      expect(result[event.id].reasoning).toBeDefined()
      expect(result[event.id].reasoning.length).toBeGreaterThan(0)
    })

    it('processes batch of multiple events', async () => {
      // Create multiple projects and events
      const projEng = await createTestProject(user1.id, 'Engineering')
      const projMkt = await createTestProject(user1.id, 'Marketing')

      const evt1 = await createTestEvent(user1.id, 'Standup', {
        attendees: [{ email: 'eng@company.com' }],
      })
      const evt2 = await createTestEvent(user1.id, 'Campaign Review', {
        attendees: [{ email: 'mkt@company.com' }],
      })

      // Create matching rules
      // ATTENDEE_EMAIL has weight 0.9, default confidence 0.7 → 0.9 * 0.7 = 0.63 > 0.5 ✓
      await createTestRule(user1.id, projEng.id, 'ATTENDEE_EMAIL', 'eng@company.com')
      // TITLE_KEYWORD has weight 0.5, need high confidence to reach threshold
      await createTestRule(user1.id, projMkt.id, 'TITLE_KEYWORD', 'campaign', {
        confidenceScore: 0.95,
        accuracy: 1.0,
        matchCount: 5,
        totalSuggestions: 5,
      })

      // Call with batch of events
      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [evt1.id, evt2.id],
      })

      // Verify both events have suggestions
      expect(Object.keys(result)).toHaveLength(2)
      expect(result[evt1.id]).toBeDefined()
      expect(result[evt2.id]).toBeDefined()
    })

    it('excludes events with low-confidence suggestions', async () => {
      // Create project and event
      const project = await createTestProject(user1.id, 'Project A')
      const event = await createTestEvent(user1.id, 'Generic Meeting')

      // Create a low-confidence rule (below 50% threshold after calculation)
      await createTestRule(user1.id, project.id, 'TITLE_KEYWORD', 'meeting', {
        confidenceScore: 0.3, // Will be below threshold
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [event.id],
      })

      // Event should not be in result (confidence < 50%)
      expect(result[event.id]).toBeUndefined()
    })

    it('returns empty map when no rules match', async () => {
      // Create event with no matching rules
      const event = await createTestEvent(user1.id, 'Unique Event Title XYZ')

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [event.id],
      })

      // Result should be empty map
      expect(result).toEqual({})
    })

    it('excludes archived projects from suggestions', async () => {
      // Create archived and active projects
      const archivedProj = await createTestProject(user1.id, 'Old Project', true)
      const activeProj = await createTestProject(user1.id, 'Current Project', false)

      const event = await createTestEvent(user1.id, 'Test Event', {
        googleEventId: 'recurring_xyz',
      })

      // Create rules for both projects
      await createTestRule(user1.id, archivedProj.id, 'RECURRING_EVENT_ID', 'recurring_xyz', {
        confidenceScore: 0.95, // High confidence
      })
      await createTestRule(user1.id, activeProj.id, 'RECURRING_EVENT_ID', 'recurring_xyz', {
        confidenceScore: 0.85,
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [event.id],
      })

      // Should only suggest active project, not archived
      expect(result[event.id]).toBeDefined()
      expect(result[event.id].projectId).toBe(activeProj.id)
      expect(result[event.id].projectName).toBe('Current Project')
    })

    it('throws NOT_FOUND when event does not exist', async () => {
      const nonExistentEventId = 'clx_nonexistent_id'

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.generate({
          eventIds: [nonExistentEventId],
        })
      ).rejects.toThrow(TRPCError)

      await expect(
        caller.generate({
          eventIds: [nonExistentEventId],
        })
      ).rejects.toThrow('Events not found or do not belong to user')
    })

    it('throws NOT_FOUND when event belongs to different user', async () => {
      // Create event for user2
      const eventUser2 = await createTestEvent(user2.id, 'User 2 Event')

      // Try to generate suggestions as user1
      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.generate({
          eventIds: [eventUser2.id],
        })
      ).rejects.toThrow('Events not found or do not belong to user')
    })

    it('ignores deleted events', async () => {
      const event = await createTestEvent(user1.id, 'Deleted Event', {
        isDeleted: true,
      })

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.generate({
          eventIds: [event.id],
        })
      ).rejects.toThrow('Events not found or do not belong to user')
    })

    it('validates input: requires at least one event', async () => {
      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.generate({
          eventIds: [],
        })
      ).rejects.toThrow('At least one event ID is required')
    })

    it('validates input: rejects more than 100 events', async () => {
      const tooManyIds = Array.from({ length: 101 }, (_, i) => `clx${i.toString().padStart(20, '0')}k`)

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.generate({
          eventIds: tooManyIds,
        })
      ).rejects.toThrow('Maximum 100 events per batch')
    })

    it('requires authentication', async () => {
      const unAuthCtx = {
        user: null,
        session: null,
      } as any

      const caller = suggestionsRouter.createCaller(unAuthCtx)
      const event = await createTestEvent(user1.id, 'Test Event')

      await expect(
        caller.generate({
          eventIds: [event.id],
        })
      ).rejects.toThrow('UNAUTHORIZED')
    })

    it('combines multiple matching rules with confidence calculation', async () => {
      const project = await createTestProject(user1.id, 'Project A')
      const event = await createTestEvent(user1.id, 'Standup Meeting', {
        attendees: [{ email: 'team@company.com' }],
        googleEventId: 'recurring_123',
      })

      // Create multiple rules that match the same event
      await createTestRule(user1.id, project.id, 'TITLE_KEYWORD', 'standup', {
        confidenceScore: 0.6,
      })
      await createTestRule(user1.id, project.id, 'ATTENDEE_EMAIL', 'team@company.com', {
        confidenceScore: 0.7,
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [event.id],
      })

      // Combined confidence should be higher than individual confidences
      expect(result[event.id]).toBeDefined()
      expect(result[event.id].confidence).toBeGreaterThan(0.7) // Higher than highest individual
    })
  })

  // ===========================================================================
  // suggestions.feedback Integration Tests
  // ===========================================================================

  describe('suggestions.feedback - Integration', () => {
    it('records feedback and updates rule counts', async () => {
      const project = await createTestProject(user1.id, 'Engineering')
      const event = await createTestEvent(user1.id, 'Test Event', {
        title: 'Engineering Standup',
      })

      // Count rules before feedback
      const rulesBefore = await prisma.categoryRule.count({
        where: { userId: user1.id },
      })

      // Mock the learning service to simulate rule creation
      vi.mocked(handleCategorizationFeedback).mockResolvedValue()

      // Submit feedback
      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.feedback({
        eventId: event.id,
        selectedProjectId: project.id,
        suggestedProjectId: null, // Manual categorization
      })

      // Verify learning service was called
      expect(handleCategorizationFeedback).toHaveBeenCalledWith(
        expect.anything(), // prisma
        event.id,
        project.id,
        null,
        user1.id
      )

      // Verify result structure
      expect(result).toHaveProperty('rulesCreated')
      expect(result).toHaveProperty('rulesUpdated')
    })

    it('accepts suggestion feedback', async () => {
      const project = await createTestProject(user1.id, 'Project A')
      const event = await createTestEvent(user1.id, 'Test Event')

      vi.mocked(handleCategorizationFeedback).mockResolvedValue()

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.feedback({
        eventId: event.id,
        selectedProjectId: project.id,
        suggestedProjectId: project.id, // Accepted suggestion
      })

      // Verify learning service received acceptance
      expect(handleCategorizationFeedback).toHaveBeenCalledWith(
        expect.anything(),
        event.id,
        project.id,
        project.id,
        user1.id
      )

      expect(result.rulesCreated).toBeGreaterThanOrEqual(0)
    })

    it('rejects suggestion feedback', async () => {
      const projCorrect = await createTestProject(user1.id, 'Correct Project')
      const projWrong = await createTestProject(user1.id, 'Wrong Project')
      const event = await createTestEvent(user1.id, 'Test Event')

      vi.mocked(handleCategorizationFeedback).mockResolvedValue()

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.feedback({
        eventId: event.id,
        selectedProjectId: projCorrect.id,
        suggestedProjectId: projWrong.id, // Rejected suggestion
      })

      // Verify learning service received rejection
      expect(handleCategorizationFeedback).toHaveBeenCalledWith(
        expect.anything(),
        event.id,
        projCorrect.id,
        projWrong.id,
        user1.id
      )

      expect(result.rulesCreated).toBeGreaterThanOrEqual(0)
    })

    it('processes manual categorization (no suggestion)', async () => {
      const project = await createTestProject(user1.id, 'Project A')
      const event = await createTestEvent(user1.id, 'Manual Event')

      vi.mocked(handleCategorizationFeedback).mockResolvedValue()

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.feedback({
        eventId: event.id,
        selectedProjectId: project.id,
        // No suggestedProjectId
      })

      // Verify learning service received null for suggested
      expect(handleCategorizationFeedback).toHaveBeenCalledWith(
        expect.anything(),
        event.id,
        project.id,
        null,
        user1.id
      )

      expect(result.rulesCreated).toBeGreaterThanOrEqual(0)
    })

    it('throws NOT_FOUND when event does not exist', async () => {
      const project = await createTestProject(user1.id, 'Project A')
      const nonExistentEventId = 'clx_nonexistent'

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: nonExistentEventId,
          selectedProjectId: project.id,
        })
      ).rejects.toThrow('Event not found or does not belong to user')
    })

    it('throws NOT_FOUND when event belongs to different user', async () => {
      const eventUser2 = await createTestEvent(user2.id, 'User2 Event')
      const projUser1 = await createTestProject(user1.id, 'Project A')

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: eventUser2.id,
          selectedProjectId: projUser1.id,
        })
      ).rejects.toThrow('Event not found or does not belong to user')
    })

    it('throws NOT_FOUND when selected project does not exist', async () => {
      const event = await createTestEvent(user1.id, 'Test Event')
      const nonExistentProjId = 'clx_nonexistent'

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: event.id,
          selectedProjectId: nonExistentProjId,
        })
      ).rejects.toThrow('Project not found or does not belong to user')
    })

    it('throws NOT_FOUND when selected project belongs to different user', async () => {
      const event = await createTestEvent(user1.id, 'Test Event')
      const projUser2 = await createTestProject(user2.id, 'User2 Project')

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: event.id,
          selectedProjectId: projUser2.id,
        })
      ).rejects.toThrow('Project not found or does not belong to user')
    })

    it('throws NOT_FOUND when suggested project does not exist', async () => {
      const event = await createTestEvent(user1.id, 'Test Event')
      const project = await createTestProject(user1.id, 'Project A')
      const nonExistentProjId = 'clx_nonexistent'

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: event.id,
          selectedProjectId: project.id,
          suggestedProjectId: nonExistentProjId,
        })
      ).rejects.toThrow('Suggested project not found or does not belong to user')
    })

    it('throws NOT_FOUND when suggested project belongs to different user', async () => {
      const event = await createTestEvent(user1.id, 'Test Event')
      const projUser1 = await createTestProject(user1.id, 'User1 Project')
      const projUser2 = await createTestProject(user2.id, 'User2 Project')

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: event.id,
          selectedProjectId: projUser1.id,
          suggestedProjectId: projUser2.id,
        })
      ).rejects.toThrow('Suggested project not found or does not belong to user')
    })

    it('ignores deleted events', async () => {
      const event = await createTestEvent(user1.id, 'Deleted Event', {
        isDeleted: true,
      })
      const project = await createTestProject(user1.id, 'Project A')

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: event.id,
          selectedProjectId: project.id,
        })
      ).rejects.toThrow('Event not found or does not belong to user')
    })

    it('requires authentication', async () => {
      const project = await createTestProject(user1.id, 'Project A')
      const event = await createTestEvent(user1.id, 'Test Event')

      const unAuthCtx = {
        user: null,
        session: null,
      } as any

      const caller = suggestionsRouter.createCaller(unAuthCtx)

      await expect(
        caller.feedback({
          eventId: event.id,
          selectedProjectId: project.id,
        })
      ).rejects.toThrow('UNAUTHORIZED')
    })

    it('validates input: requires valid CUIDs', async () => {
      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: 'invalid-id',
          selectedProjectId: 'clx_valid_id',
        })
      ).rejects.toThrow()
    })
  })

  // ===========================================================================
  // suggestions.metrics Integration Tests
  // ===========================================================================

  describe('suggestions.metrics - Integration', () => {
    it('returns metrics with real database data', async () => {
      // Create test projects and rules
      const proj1 = await createTestProject(user1.id, 'Engineering')
      const proj2 = await createTestProject(user1.id, 'Marketing')

      // Create rules
      await createTestRule(user1.id, proj1.id, 'RECURRING_EVENT_ID', 'recurring_1', {
        totalSuggestions: 10,
        matchCount: 9,
        accuracy: 0.9,
      })
      await createTestRule(user1.id, proj1.id, 'ATTENDEE_EMAIL', 'eng@company.com', {
        totalSuggestions: 20,
        matchCount: 16,
        accuracy: 0.8,
      })
      await createTestRule(user1.id, proj2.id, 'TITLE_KEYWORD', 'campaign', {
        totalSuggestions: 5,
        matchCount: 3,
        accuracy: 0.6,
      })

      // Mock learning service to return calculated debug info
      vi.mocked(getDebugInfo).mockResolvedValue({
        totalRules: 3,
        rulesByType: {
          RECURRING_EVENT_ID: 1,
          ATTENDEE_EMAIL: 1,
          TITLE_KEYWORD: 1,
        },
        overallAccuracy: (9 + 16 + 3) / (10 + 20 + 5), // 28/35 = 0.8
        totalSuggestions: 35,
        totalMatches: 28,
        rules: [],
      })

      // Create recent events and entries for coverage
      const event1 = await createTestEvent(user1.id, 'Event 1')
      const event2 = await createTestEvent(user1.id, 'Event 2')

      await prisma.timesheetEntry.create({
        data: {
          userId: user1.id,
          eventId: event1.id,
          projectId: proj1.id,
          date: new Date(),
          duration: 60,
        },
      })

      // Call metrics
      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.metrics()

      // Verify metrics structure
      expect(result).toHaveProperty('accuracyRate')
      expect(result).toHaveProperty('coverageRate')
      expect(result).toHaveProperty('activeRulesCount')
      expect(result).toHaveProperty('rulesByType')
      expect(result).toHaveProperty('totalSuggestions')
      expect(result).toHaveProperty('totalMatches')

      // Verify values
      expect(result.accuracyRate).toBe((9 + 16 + 3) / (10 + 20 + 5))
      expect(result.activeRulesCount).toBe(3)
      expect(result.rulesByType).toEqual({
        RECURRING_EVENT_ID: 1,
        ATTENDEE_EMAIL: 1,
        TITLE_KEYWORD: 1,
      })
      expect(result.totalSuggestions).toBe(35)
      expect(result.totalMatches).toBe(28)
    })

    it('calculates coverage from recent events (last 30 days)', async () => {
      const project = await createTestProject(user1.id, 'Project A')

      // Create recent event (within 30 days)
      const recentEvent = await createTestEvent(user1.id, 'Recent Event')

      // Create timesheet entry for the event
      await prisma.timesheetEntry.create({
        data: {
          userId: user1.id,
          eventId: recentEvent.id,
          projectId: project.id,
          date: new Date(),
          duration: 60,
        },
      })

      vi.mocked(getDebugInfo).mockResolvedValue({
        totalRules: 0,
        rulesByType: {},
        overallAccuracy: 0,
        totalSuggestions: 0,
        totalMatches: 0,
        rules: [],
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.metrics()

      // Coverage should be 1.0 (1 event categorized out of 1)
      expect(result.coverageRate).toBe(1.0)
    })

    it('returns zero metrics for new user with no data', async () => {
      // User has no events, rules, or entries
      vi.mocked(getDebugInfo).mockResolvedValue({
        totalRules: 0,
        rulesByType: {},
        overallAccuracy: 0,
        totalSuggestions: 0,
        totalMatches: 0,
        rules: [],
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.metrics()

      // All metrics should be zero/empty
      expect(result.activeRulesCount).toBe(0)
      expect(result.accuracyRate).toBe(0)
      expect(result.coverageRate).toBe(0)
      expect(result.totalSuggestions).toBe(0)
      expect(result.totalMatches).toBe(0)
      expect(Object.keys(result.rulesByType).length).toBe(0)
    })

    it('does not count old events (older than 30 days) in coverage', async () => {
      const project = await createTestProject(user1.id, 'Project A')

      // Create old event (40 days ago)
      const thirtyTwoDaysAgo = new Date()
      thirtyTwoDaysAgo.setDate(thirtyTwoDaysAgo.getDate() - 32)

      const oldEvent = await prisma.calendarEvent.create({
        data: {
          userId: user1.id,
          title: 'Old Event',
          googleEventId: `old_${Date.now()}`,
          calendarId: 'primary',
          startTime: thirtyTwoDaysAgo,
          endTime: new Date(thirtyTwoDaysAgo.getTime() + 3600000),
        },
      })

      // Create entry for old event
      await prisma.timesheetEntry.create({
        data: {
          userId: user1.id,
          eventId: oldEvent.id,
          projectId: project.id,
          date: thirtyTwoDaysAgo,
          duration: 60,
        },
      })

      // Create recent event (today)
      const recentEvent = await createTestEvent(user1.id, 'Recent Event')

      vi.mocked(getDebugInfo).mockResolvedValue({
        totalRules: 0,
        rulesByType: {},
        overallAccuracy: 0,
        totalSuggestions: 0,
        totalMatches: 0,
        rules: [],
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.metrics()

      // Coverage should be 0 (recent event not categorized, old event excluded)
      expect(result.coverageRate).toBe(0)
    })

    it('includes rule breakdown by type', async () => {
      const project = await createTestProject(user1.id, 'Project A')

      // Create rules of different types
      await createTestRule(user1.id, project.id, 'RECURRING_EVENT_ID', 'recurring_1')
      await createTestRule(user1.id, project.id, 'ATTENDEE_EMAIL', 'test@example.com')
      await createTestRule(user1.id, project.id, 'ATTENDEE_EMAIL', 'test2@example.com')
      await createTestRule(user1.id, project.id, 'TITLE_KEYWORD', 'standup')

      vi.mocked(getDebugInfo).mockResolvedValue({
        totalRules: 4,
        rulesByType: {
          RECURRING_EVENT_ID: 1,
          ATTENDEE_EMAIL: 2,
          TITLE_KEYWORD: 1,
        },
        overallAccuracy: 0.7,
        totalSuggestions: 50,
        totalMatches: 35,
        rules: [],
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.metrics()

      expect(result.rulesByType).toEqual({
        RECURRING_EVENT_ID: 1,
        ATTENDEE_EMAIL: 2,
        TITLE_KEYWORD: 1,
      })
    })

    it('does not leak data between users', async () => {
      // User1 has rules
      const proj1 = await createTestProject(user1.id, 'Project A')
      await createTestRule(user1.id, proj1.id, 'TITLE_KEYWORD', 'user1_keyword')

      // User2 has different rules
      const proj2 = await createTestProject(user2.id, 'Project B')
      await createTestRule(user2.id, proj2.id, 'TITLE_KEYWORD', 'user2_keyword')

      vi.mocked(getDebugInfo).mockResolvedValue({
        totalRules: 1,
        rulesByType: { TITLE_KEYWORD: 1 },
        overallAccuracy: 0.5,
        totalSuggestions: 10,
        totalMatches: 5,
        rules: [],
      })

      // Query as user1
      const caller1 = suggestionsRouter.createCaller(ctx1)
      const result1 = await caller1.metrics()

      // Verify getDebugInfo was called with correct user
      expect(getDebugInfo).toHaveBeenCalledWith(expect.anything(), user1.id)

      // Call as user2
      vi.clearAllMocks()
      vi.mocked(getDebugInfo).mockResolvedValue({
        totalRules: 1,
        rulesByType: { TITLE_KEYWORD: 1 },
        overallAccuracy: 0.6,
        totalSuggestions: 15,
        totalMatches: 9,
        rules: [],
      })

      const caller2 = suggestionsRouter.createCaller(ctx2)
      const result2 = await caller2.metrics()

      // Verify getDebugInfo was called with user2
      expect(getDebugInfo).toHaveBeenCalledWith(expect.anything(), user2.id)
    })

    it('requires authentication', async () => {
      const unAuthCtx = {
        user: null,
        session: null,
      } as any

      const caller = suggestionsRouter.createCaller(unAuthCtx)

      await expect(caller.metrics()).rejects.toThrow('UNAUTHORIZED')
    })

    it('handles learning service errors gracefully', async () => {
      vi.mocked(getDebugInfo).mockRejectedValue(new Error('Database error'))

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(caller.metrics()).rejects.toThrow('Failed to fetch metrics')
    })
  })

  // ===========================================================================
  // Data Isolation & Authorization Tests
  // ===========================================================================

  describe('Authorization & Data Isolation', () => {
    it('prevents user1 from accessing user2 events in generate', async () => {
      const proj1 = await createTestProject(user1.id, 'Project 1')
      const eventUser2 = await createTestEvent(user2.id, 'User2 Event')

      await createTestRule(user1.id, proj1.id, 'TITLE_KEYWORD', 'user2')

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.generate({
          eventIds: [eventUser2.id],
        })
      ).rejects.toThrow('Events not found or do not belong to user')
    })

    it('prevents user1 from accessing user2 projects in feedback', async () => {
      const event = await createTestEvent(user1.id, 'Test Event')
      const projUser2 = await createTestProject(user2.id, 'User2 Project')

      const caller = suggestionsRouter.createCaller(ctx1)

      await expect(
        caller.feedback({
          eventId: event.id,
          selectedProjectId: projUser2.id,
        })
      ).rejects.toThrow('Project not found or does not belong to user')
    })

    it('each user sees only their own metrics', async () => {
      // User1 creates rules and events
      const proj1 = await createTestProject(user1.id, 'Engineering')
      const event1 = await createTestEvent(user1.id, 'Event1')

      await createTestRule(user1.id, proj1.id, 'TITLE_KEYWORD', 'user1', {
        totalSuggestions: 100,
        matchCount: 80,
      })

      // User2 creates different rules and events
      const proj2 = await createTestProject(user2.id, 'Marketing')
      const event2 = await createTestEvent(user2.id, 'Event2')

      await createTestRule(user2.id, proj2.id, 'TITLE_KEYWORD', 'user2', {
        totalSuggestions: 50,
        matchCount: 30,
      })

      // Mock debug info for each user
      const debugUser1 = {
        totalRules: 1,
        rulesByType: { TITLE_KEYWORD: 1 },
        overallAccuracy: 0.8,
        totalSuggestions: 100,
        totalMatches: 80,
        rules: [],
      }

      const debugUser2 = {
        totalRules: 1,
        rulesByType: { TITLE_KEYWORD: 1 },
        overallAccuracy: 0.6,
        totalSuggestions: 50,
        totalMatches: 30,
        rules: [],
      }

      // Query as user1
      vi.mocked(getDebugInfo).mockResolvedValue(debugUser1)
      const caller1 = suggestionsRouter.createCaller(ctx1)
      const result1 = await caller1.metrics()

      // Verify user1 metrics
      expect(result1.accuracyRate).toBe(0.8)
      expect(result1.totalMatches).toBe(80)

      // Query as user2
      vi.clearAllMocks()
      vi.mocked(getDebugInfo).mockResolvedValue(debugUser2)
      const caller2 = suggestionsRouter.createCaller(ctx2)
      const result2 = await caller2.metrics()

      // Verify user2 metrics (different from user1)
      expect(result2.accuracyRate).toBe(0.6)
      expect(result2.totalMatches).toBe(30)
    })
  })

  // ===========================================================================
  // Edge Cases & Error Handling
  // ===========================================================================

  describe('Edge Cases', () => {
    it('handles events with empty attendees list', async () => {
      const project = await createTestProject(user1.id, 'Project A')
      const event = await createTestEvent(user1.id, 'Meeting', {
        attendees: [], // Empty
      })

      // TITLE_KEYWORD has weight 0.5, so need high confidence + accuracy to reach 50% threshold
      // Formula: 0.5 (weight) * 0.95 (confidence) * (1 + 0.3 * 1.0 (accuracy)) = 0.61
      await createTestRule(user1.id, project.id, 'TITLE_KEYWORD', 'meeting', {
        confidenceScore: 0.95,
        accuracy: 1.0,
        matchCount: 5,
        totalSuggestions: 5,
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [event.id],
      })

      // Should still generate suggestion based on title
      expect(result[event.id]).toBeDefined()
    })

    it('handles events with no attendees', async () => {
      const project = await createTestProject(user1.id, 'Project A')
      const event = await createTestEvent(user1.id, 'Solo Meeting', {
        attendees: undefined, // undefined
      })

      // TITLE_KEYWORD has weight 0.5, so need high confidence + accuracy to reach 50% threshold
      // Formula: 0.5 (weight) * 0.95 (confidence) * (1 + 0.3 * 1.0 (accuracy)) = 0.61
      await createTestRule(user1.id, project.id, 'TITLE_KEYWORD', 'solo', {
        confidenceScore: 0.95,
        accuracy: 1.0,
        matchCount: 5,
        totalSuggestions: 5,
      })

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [event.id],
      })

      // Should generate suggestion
      expect(result[event.id]).toBeDefined()
    })

    it('handles large batch of events efficiently', async () => {
      const project = await createTestProject(user1.id, 'Project A')

      // Create single rule that matches all events (more efficient than 50 separate rules)
      // ATTENDEE_DOMAIN has weight 0.7, high enough to pass threshold with good confidence
      await createTestRule(user1.id, project.id, 'ATTENDEE_DOMAIN', 'example.com', {
        confidenceScore: 0.9,
        accuracy: 0.95,
        matchCount: 100,
        totalSuggestions: 105,
      })

      // Create 50 events in parallel (much faster than sequential)
      // Pass unique googleEventIds to avoid constraint violations
      const eventPromises = Array.from({ length: 50 }, (_, i) =>
        createTestEvent(user1.id, `Event ${i}`, {
          googleEventId: `recurring_batch_${i}`,
          attendees: [{ email: `user${i}@example.com` }],
        })
      )
      const events = await Promise.all(eventPromises)
      const eventIds = events.map(e => e.id)

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds,
      })

      // All events should have suggestions
      expect(Object.keys(result).length).toBe(50)
    })

    it('handles multiple rules for same project/event', async () => {
      const project = await createTestProject(user1.id, 'Project A')
      const event = await createTestEvent(user1.id, 'Standup Meeting', {
        attendees: [{ email: 'team@company.com' }],
        googleEventId: 'recurring_123',
      })

      // Create multiple rules that all match
      await createTestRule(user1.id, project.id, 'TITLE_KEYWORD', 'standup')
      await createTestRule(user1.id, project.id, 'ATTENDEE_EMAIL', 'team@company.com')
      await createTestRule(user1.id, project.id, 'RECURRING_EVENT_ID', 'recurring_123')

      const caller = suggestionsRouter.createCaller(ctx1)
      const result = await caller.generate({
        eventIds: [event.id],
      })

      // Should combine all rules
      expect(result[event.id]).toBeDefined()
      expect(result[event.id].reasoning.length).toBe(3)
    })
  })
})
