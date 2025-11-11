/**
 * AI Categorization End-to-End Integration Tests
 *
 * Tests complete user journeys through the AI categorization system:
 * 1. New User Flow - Cold start to learned patterns
 * 2. Feedback Loop - Suggestion accuracy improvement
 * 3. Performance - Batch suggestion generation
 *
 * @module ai-e2e.integration.test
 * @see docs/AI_ENGINE.md for architecture
 * @see docs/TESTING.md for testing strategy
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  getSuggestionsForEvent,
  type CalendarEventInput,
} from '../ai-categorization'
import { handleCategorizationFeedback } from '../learning'
import {
  createTestUser,
  createTestProject,
  createTestEvent,
  cleanupTestData,
  disconnectPrisma,
  type TestUser,
} from '../../test-utils'

// Test database setup
const prisma = new PrismaClient()

// =============================================================================
// TEST 1: NEW USER FLOW
// =============================================================================

describe('E2E: New User Flow', () => {
  let testUser: TestUser | null = null

  afterEach(async () => {
    if (testUser) {
      await cleanupTestData(testUser.id)
      testUser = null
    }
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await disconnectPrisma()
  })

  it('should guide user from cold start to learned patterns', async () => {
    // SETUP: Create user and two projects
    testUser = await createTestUser()
    const engineeringProject = await createTestProject(testUser.id, 'Engineering')
    const salesProject = await createTestProject(testUser.id, 'Sales')

    // PHASE 1: Cold start - no suggestions (0 categorizations)
    const event1 = await createTestEvent(testUser.id, 'Engineering Standup', {
      attendees: [{ email: 'dev@acme.com' }],
      startTime: new Date('2025-11-11T09:00:00Z'),
      endTime: new Date('2025-11-11T10:00:00Z'),
    })

    let suggestions = await getSuggestionsForEvent(
      prisma,
      testUser.id,
      event1 as CalendarEventInput
    )
    expect(suggestions).toEqual([])

    // User manually categorizes event 1
    await prisma.timesheetEntry.create({
      data: {
        userId: testUser.id,
        projectId: engineeringProject.id,
        eventId: event1.id,
        date: new Date('2025-11-11'),
        hours: 1,
        notes: null,
      },
    })
    await handleCategorizationFeedback(
      prisma,
      event1.id,
      engineeringProject.id,
      null,
      testUser.id
    )

    // PHASE 2: Still in cold start (1-4 categorizations)
    for (let i = 2; i <= 4; i++) {
      const event = await createTestEvent(testUser.id, `Engineering Sync ${i}`, {
        attendees: [{ email: 'dev@acme.com' }],
        startTime: new Date(`2025-11-11T${9 + i}:00:00Z`),
        endTime: new Date(`2025-11-11T${10 + i}:00:00Z`),
      })

      suggestions = await getSuggestionsForEvent(
        prisma,
        testUser.id,
        event as CalendarEventInput
      )
      expect(suggestions).toEqual([])

      // User manually categorizes
      await prisma.timesheetEntry.create({
        data: {
          userId: testUser.id,
          projectId: engineeringProject.id,
          eventId: event.id,
          date: new Date('2025-11-11'),
          hours: 1,
          notes: null,
        },
      })
      await handleCategorizationFeedback(
        prisma,
        event.id,
        engineeringProject.id,
        null,
        testUser.id
      )
    }

    // PHASE 3: Exit cold start (5 categorizations) - AI should now suggest
    const event5 = await createTestEvent(testUser.id, 'Engineering Planning', {
      attendees: [{ email: 'dev@acme.com' }],
      startTime: new Date('2025-11-11T14:00:00Z'),
      endTime: new Date('2025-11-11T15:00:00Z'),
    })

    suggestions = await getSuggestionsForEvent(
      prisma,
      testUser.id,
      event5 as CalendarEventInput
    )
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].projectId).toBe(engineeringProject.id)
    expect(suggestions[0].confidence).toBeGreaterThan(0.5)

    // Accept suggestion
    await prisma.timesheetEntry.create({
      data: {
        userId: testUser.id,
        projectId: engineeringProject.id,
        eventId: event5.id,
        date: new Date('2025-11-11'),
        hours: 1,
        notes: null,
      },
    })
    await handleCategorizationFeedback(
      prisma,
      event5.id,
      engineeringProject.id,
      engineeringProject.id,
      testUser.id
    )

    // PHASE 4: Categorize 5 more events (mix of accept/manual)
    for (let i = 6; i <= 10; i++) {
      const isEngineering = i % 3 !== 0 // 7/10 engineering, 3/10 sales
      const project = isEngineering ? engineeringProject : salesProject
      const title = isEngineering ? `Engineering Review ${i}` : `Sales Call ${i}`
      const attendeeEmail = isEngineering ? 'dev@acme.com' : 'sales@acme.com'

      const event = await createTestEvent(testUser.id, title, {
        attendees: [{ email: attendeeEmail }],
        startTime: new Date(`2025-11-${10 + (i - 5)}T09:00:00Z`),
        endTime: new Date(`2025-11-${10 + (i - 5)}T10:00:00Z`),
      })

      // Get suggestions
      suggestions = await getSuggestionsForEvent(
        prisma,
        testUser.id,
        event as CalendarEventInput
      )

      // User categorizes (may or may not match suggestion)
      await prisma.timesheetEntry.create({
        data: {
          userId: testUser.id,
          projectId: project.id,
          eventId: event.id,
          date: new Date(`2025-11-${10 + (i - 5)}`),
          hours: 1,
          notes: null,
        },
      })

      const suggestedProjectId = suggestions.length > 0 ? suggestions[0].projectId : null
      await handleCategorizationFeedback(
        prisma,
        event.id,
        project.id,
        suggestedProjectId,
        testUser.id
      )
    }

    // PHASE 5: Verify AI learned patterns
    // Test engineering pattern
    const engineeringTest = await createTestEvent(testUser.id, 'Engineering Standup', {
      attendees: [{ email: 'dev@acme.com' }],
      startTime: new Date('2025-11-20T09:00:00Z'),
      endTime: new Date('2025-11-20T10:00:00Z'),
    })

    suggestions = await getSuggestionsForEvent(
      prisma,
      testUser.id,
      engineeringTest as CalendarEventInput
    )
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].projectId).toBe(engineeringProject.id)

    // Test sales pattern
    const salesTest = await createTestEvent(testUser.id, 'Sales Quarterly Review', {
      attendees: [{ email: 'sales@acme.com' }],
      startTime: new Date('2025-11-20T14:00:00Z'),
      endTime: new Date('2025-11-20T15:00:00Z'),
    })

    suggestions = await getSuggestionsForEvent(
      prisma,
      testUser.id,
      salesTest as CalendarEventInput
    )
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].projectId).toBe(salesProject.id)

    // VERIFICATION: Check rules were created
    const rules = await prisma.categoryRule.findMany({
      where: { userId: testUser.id },
    })
    expect(rules.length).toBeGreaterThan(0)

    // Verify rule types created (should have TITLE_KEYWORD and ATTENDEE_EMAIL at minimum)
    const ruleTypes = new Set(rules.map((r) => r.ruleType))
    expect(ruleTypes.has('TITLE_KEYWORD')).toBe(true)
    expect(ruleTypes.has('ATTENDEE_EMAIL')).toBe(true)

    // Verify rules have reasonable confidence scores
    const avgConfidence = rules.reduce((sum, r) => sum + r.confidenceScore, 0) / rules.length
    expect(avgConfidence).toBeGreaterThan(0.5)
    expect(avgConfidence).toBeLessThan(1.0)
  })
})

// =============================================================================
// TEST 2: FEEDBACK LOOP
// =============================================================================

describe('E2E: Feedback Loop', () => {
  let testUser: TestUser | null = null

  afterEach(async () => {
    if (testUser) {
      await cleanupTestData(testUser.id)
      testUser = null
    }
  })

  afterAll(async () => {
    await disconnectPrisma()
  })

  it('should improve suggestion accuracy through accept/reject feedback', async () => {
    // SETUP: Create user, projects, and initial categorizations to exit cold start
    testUser = await createTestUser()
    const projectA = await createTestProject(testUser.id, 'Project A')
    const projectB = await createTestProject(testUser.id, 'Project B')

    // Create 5 categorizations to exit cold start
    for (let i = 1; i <= 5; i++) {
      const event = await createTestEvent(testUser.id, 'Initial Setup Meeting', {
        startTime: new Date(`2025-11-0${i}T09:00:00Z`),
        endTime: new Date(`2025-11-0${i}T10:00:00Z`),
      })
      await prisma.timesheetEntry.create({
        data: {
          userId: testUser.id,
          projectId: projectA.id,
          eventId: event.id,
          date: new Date(`2025-11-0${i}`),
          hours: 1,
          notes: null,
        },
      })
      await handleCategorizationFeedback(prisma, event.id, projectA.id, null, testUser.id)
    }

    // PHASE 1: Generate initial suggestion
    const testEvent = await createTestEvent(testUser.id, 'Setup Planning Session', {
      attendees: [{ email: 'team@example.com' }],
      startTime: new Date('2025-11-10T09:00:00Z'),
      endTime: new Date('2025-11-10T10:00:00Z'),
    })

    let suggestions = await getSuggestionsForEvent(
      prisma,
      testUser.id,
      testEvent as CalendarEventInput
    )
    expect(suggestions.length).toBeGreaterThan(0)
    const initialSuggestion = suggestions[0]
    const initialConfidence = initialSuggestion.confidence

    // PHASE 2: Accept suggestion (should boost confidence)
    await prisma.timesheetEntry.create({
      data: {
        userId: testUser.id,
        projectId: initialSuggestion.projectId,
        eventId: testEvent.id,
        date: new Date('2025-11-10'),
        hours: 1,
        notes: null,
      },
    })
    await handleCategorizationFeedback(
      prisma,
      testEvent.id,
      initialSuggestion.projectId,
      initialSuggestion.projectId,
      testUser.id
    )

    // Re-generate suggestions for similar event
    const event2 = await createTestEvent(testUser.id, 'Setup Planning Session', {
      attendees: [{ email: 'team@example.com' }],
      startTime: new Date('2025-11-11T09:00:00Z'),
      endTime: new Date('2025-11-11T10:00:00Z'),
    })

    suggestions = await getSuggestionsForEvent(
      prisma,
      testUser.id,
      event2 as CalendarEventInput
    )
    expect(suggestions.length).toBeGreaterThan(0)
    const boostedConfidence = suggestions[0].confidence
    expect(boostedConfidence).toBeGreaterThanOrEqual(initialConfidence)

    // PHASE 3: Reject suggestion (should penalize confidence)
    await prisma.timesheetEntry.create({
      data: {
        userId: testUser.id,
        projectId: projectB.id,
        eventId: event2.id,
        date: new Date('2025-11-11'),
        hours: 1,
        notes: null,
      },
    })
    await handleCategorizationFeedback(
      prisma,
      event2.id,
      projectB.id,
      suggestions[0].projectId,
      testUser.id
    )

    // Re-generate suggestions for similar event
    const event3 = await createTestEvent(testUser.id, 'Setup Planning Session', {
      attendees: [{ email: 'team@example.com' }],
      startTime: new Date('2025-11-12T09:00:00Z'),
      endTime: new Date('2025-11-12T10:00:00Z'),
    })

    suggestions = await getSuggestionsForEvent(
      prisma,
      testUser.id,
      event3 as CalendarEventInput
    )

    // Confidence should be adjusted based on feedback
    // Either lower confidence for rejected project, or different project suggested
    if (suggestions.length > 0) {
      const afterRejection = suggestions[0]
      const hasLowerConfidence = afterRejection.confidence < boostedConfidence
      const switchedProject = afterRejection.projectId === projectB.id
      expect(hasLowerConfidence || switchedProject).toBe(true)
    }

    // PHASE 4: Verify confidence updates persisted in rules
    const rules = await prisma.categoryRule.findMany({
      where: { userId: testUser.id },
      orderBy: { lastMatchedAt: 'desc' },
    })

    expect(rules.length).toBeGreaterThan(0)

    // Check that rules have accuracy tracking
    const rulesWithAccuracy = rules.filter((r) => r.totalSuggestions > 0)
    expect(rulesWithAccuracy.length).toBeGreaterThan(0)

    // Verify rules were updated recently
    const recentlyUpdated = rules.filter(
      (r) => r.lastMatchedAt && r.lastMatchedAt > new Date('2025-11-09')
    )
    expect(recentlyUpdated.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// TEST 3: PERFORMANCE TEST
// =============================================================================

describe('E2E: Performance Test', () => {
  let testUser: TestUser | null = null

  afterEach(async () => {
    if (testUser) {
      await cleanupTestData(testUser.id)
      testUser = null
    }
  })

  afterAll(async () => {
    await disconnectPrisma()
  })

  it('should handle 1000 events and generate suggestions without errors', async () => {
    // SETUP: Create user and projects
    testUser = await createTestUser()
    const projects = await Promise.all([
      createTestProject(testUser.id, 'Engineering'),
      createTestProject(testUser.id, 'Sales'),
      createTestProject(testUser.id, 'Marketing'),
    ])

    // Create initial categorizations to exit cold start and train patterns
    console.log('[Perf Test] Creating initial training data...')
    for (let i = 0; i < 10; i++) {
      const project = projects[i % 3]
      const projectNames = ['Engineering', 'Sales', 'Marketing']
      const projectName = projectNames[i % 3]
      const event = await createTestEvent(testUser.id, `${projectName} Meeting ${i}`, {
        attendees: [{ email: `${projectName.toLowerCase()}@acme.com` }],
        startTime: new Date(`2025-11-01T${9 + i}:00:00Z`),
        endTime: new Date(`2025-11-01T${10 + i}:00:00Z`),
      })
      await prisma.timesheetEntry.create({
        data: {
          userId: testUser.id,
          projectId: project.id,
          eventId: event.id,
          date: new Date('2025-11-01'),
          hours: 1,
          notes: null,
        },
      })
      await handleCategorizationFeedback(prisma, event.id, project.id, null, testUser.id)
    }

    // PHASE 1: Create 1000 test events
    console.log('[Perf Test] Creating 1000 events...')
    const startCreate = Date.now()
    const eventPromises = []
    for (let i = 0; i < 1000; i++) {
      const projectIndex = i % 3
      const projectNames = ['Engineering', 'Sales', 'Marketing']
      const projectName = projectNames[projectIndex]
      const day = Math.floor(i / 24) + 1
      const hour = i % 24

      eventPromises.push(
        createTestEvent(testUser.id, `${projectName} Sync ${i}`, {
          attendees: [{ email: `${projectName.toLowerCase()}@acme.com` }],
          startTime: new Date(`2025-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`),
          endTime: new Date(`2025-11-${String(day).padStart(2, '0')}T${String(hour + 1).padStart(2, '0')}:00:00Z`),
        })
      )
    }
    const events = await Promise.all(eventPromises)
    const createTime = Date.now() - startCreate
    console.log(`[Perf Test] Created 1000 events in ${createTime}ms`)

    // PHASE 2: Generate suggestions in batches of 100
    console.log('[Perf Test] Generating suggestions in batches of 100...')
    const batchTimes: number[] = []
    const batchSize = 100
    let totalSuggestions = 0

    for (let batchStart = 0; batchStart < events.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, events.length)
      const batch = events.slice(batchStart, batchEnd)

      const startBatch = Date.now()
      const suggestionPromises = batch.map((event) =>
        getSuggestionsForEvent(prisma, testUser.id, event as CalendarEventInput)
      )
      const batchResults = await Promise.all(suggestionPromises)
      const batchTime = Date.now() - startBatch

      // Verify functional behavior: all suggestions returned successfully
      expect(batchResults).toHaveLength(batch.length)
      batchResults.forEach((suggestions) => {
        expect(Array.isArray(suggestions)).toBe(true)
        totalSuggestions += suggestions.length
      })

      batchTimes.push(batchTime)
      console.debug(`[Perf Test] Batch ${batchStart / batchSize + 1}: ${batchTime}ms`)
    }

    // FUNCTIONAL VERIFICATION: All 1000 events processed successfully
    expect(events).toHaveLength(1000)
    expect(batchTimes).toHaveLength(10) // 1000 events / 100 per batch = 10 batches

    // Diagnostic timing logs (not asserted in CI)
    const failedBatches = batchTimes.filter((time) => time > 500)
    const avgTime = batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length
    console.info(`[Perf Test] Batch times: min=${Math.min(...batchTimes)}ms, max=${Math.max(...batchTimes)}ms, avg=${Math.round(avgTime)}ms`)
    console.info(`[Perf Test] Batches >500ms: ${failedBatches.length}/${batchTimes.length}`)
    console.info(`[Perf Test] Total suggestions generated: ${totalSuggestions}`)

    // Optional: Assert timing only if explicitly enabled (e.g., for local performance regression testing)
    if (process.env.ENABLE_PERF_ASSERTS === 'true') {
      const failureRate = failedBatches.length / batchTimes.length
      expect(failureRate).toBeLessThan(0.2)
      expect(avgTime).toBeLessThan(400)
    }

    // PHASE 3: Test individual suggestion response time
    console.log('[Perf Test] Testing individual suggestion response times...')
    const sampleEvents = events.slice(0, 100)
    const individualTimes: number[] = []
    let individualSuggestions = 0

    for (const event of sampleEvents) {
      const start = Date.now()
      const suggestions = await getSuggestionsForEvent(prisma, testUser.id, event as CalendarEventInput)
      individualTimes.push(Date.now() - start)

      // Verify functional behavior: suggestions return without throwing
      expect(Array.isArray(suggestions)).toBe(true)
      individualSuggestions += suggestions.length
    }

    // FUNCTIONAL VERIFICATION: All 100 sample events processed successfully
    expect(sampleEvents).toHaveLength(100)
    expect(individualTimes).toHaveLength(100)

    // Diagnostic timing logs (not asserted in CI)
    const avgIndividual = individualTimes.reduce((a, b) => a + b) / individualTimes.length
    const maxIndividual = Math.max(...individualTimes)
    const minIndividual = Math.min(...individualTimes)
    console.info(`[Perf Test] Individual times: min=${minIndividual}ms, avg=${avgIndividual.toFixed(2)}ms, max=${maxIndividual}ms`)
    console.info(`[Perf Test] Individual suggestions generated: ${individualSuggestions}`)

    // Optional: Assert timing only if explicitly enabled (e.g., for local performance regression testing)
    if (process.env.ENABLE_PERF_ASSERTS === 'true') {
      expect(avgIndividual).toBeLessThan(50)
      expect(maxIndividual).toBeLessThan(200)
    }
  }, 60000) // 60 second timeout for performance test
})
