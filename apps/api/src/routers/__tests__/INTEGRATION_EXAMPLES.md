# Integration Test Examples

This document provides detailed examples from the suggestions router integration tests to help understand the testing patterns used.

## Example 1: Basic Suggestion Generation Test

```typescript
it('generates suggestions for events with matching rules', async () => {
  // ARRANGE: Set up test data
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

  // ACT: Call the endpoint
  const caller = suggestionsRouter.createCaller(ctx1)
  const result = await caller.generate({
    eventIds: [event.id],
  })

  // ASSERT: Verify the suggestion was generated
  expect(result[event.id]).toBeDefined()
  expect(result[event.id].projectId).toBe(project.id)
  expect(result[event.id].projectName).toBe('Engineering')
  expect(result[event.id].confidence).toBeGreaterThan(0.5)
  expect(result[event.id].reasoning).toBeDefined()
  expect(result[event.id].reasoning.length).toBeGreaterThan(0)
})
```

**Key Points:**
- Uses AAA pattern (Arrange, Act, Assert)
- Creates real database data, not mocks
- Tests actual suggestion algorithm
- Verifies complete response structure

## Example 2: Error Handling - Authorization

```typescript
it('throws NOT_FOUND when event belongs to different user', async () => {
  // ARRANGE: Create event for user2
  const eventUser2 = await createTestEvent(user2.id, 'User 2 Event')

  // ACT: Try to generate suggestions as user1
  const caller = suggestionsRouter.createCaller(ctx1)

  // ASSERT: Verify error is thrown
  await expect(
    caller.generate({
      eventIds: [eventUser2.id],
    })
  ).rejects.toThrow('Events not found or do not belong to user')
})
```

**Key Points:**
- Tests cross-user access prevention
- Verifies correct error message
- Uses two users (user1, user2) for isolation testing
- Ensures no data leakage between users

## Example 3: Batch Processing

```typescript
it('processes batch of multiple events', async () => {
  // ARRANGE: Create multiple projects and events
  const projEng = await createTestProject(user1.id, 'Engineering')
  const projMkt = await createTestProject(user1.id, 'Marketing')

  const evt1 = await createTestEvent(user1.id, 'Standup', {
    attendees: [{ email: 'eng@company.com' }],
  })
  const evt2 = await createTestEvent(user1.id, 'Campaign Review', {
    attendees: [{ email: 'mkt@company.com' }],
  })

  // Create matching rules
  await createTestRule(user1.id, projEng.id, 'ATTENDEE_EMAIL', 'eng@company.com')
  await createTestRule(user1.id, projMkt.id, 'TITLE_KEYWORD', 'campaign')

  // ACT: Call with batch of events
  const caller = suggestionsRouter.createCaller(ctx1)
  const result = await caller.generate({
    eventIds: [evt1.id, evt2.id],
  })

  // ASSERT: Verify both events have suggestions
  expect(Object.keys(result)).toHaveLength(2)
  expect(result[evt1.id]).toBeDefined()
  expect(result[evt2.id]).toBeDefined()
})
```

**Key Points:**
- Tests batch processing capability
- Multiple projects with different rules
- Verifies all items in batch are processed
- Uses distinct rule types for each event

## Example 4: Feedback Processing

```typescript
it('accepts suggestion feedback', async () => {
  // ARRANGE: Create event and project
  const project = await createTestProject(user1.id, 'Project A')
  const event = await createTestEvent(user1.id, 'Test Event')

  // Mock the learning service
  vi.mocked(handleCategorizationFeedback).mockResolvedValue()

  // ACT: Submit feedback accepting suggestion
  const caller = suggestionsRouter.createCaller(ctx1)
  const result = await caller.feedback({
    eventId: event.id,
    selectedProjectId: project.id,
    suggestedProjectId: project.id, // Accepted suggestion
  })

  // ASSERT: Verify learning service was called correctly
  expect(handleCategorizationFeedback).toHaveBeenCalledWith(
    expect.anything(),
    event.id,
    project.id,
    project.id, // Same as selected = accepted
    user1.id
  )

  expect(result.rulesCreated).toBeGreaterThanOrEqual(0)
})
```

**Key Points:**
- Tests feedback submission flow
- Mocks learning service to focus on router logic
- Verifies correct parameters passed to service
- Checks response structure

## Example 5: Input Validation

```typescript
it('validates input: rejects more than 100 events', async () => {
  // ARRANGE: Create array of 101 event IDs
  const tooManyIds = Array.from({ length: 101 }, (_, i) =>
    `clx${i.toString().padStart(20, '0')}k`
  )

  // ACT & ASSERT: Verify input is rejected
  const caller = suggestionsRouter.createCaller(ctx1)

  await expect(
    caller.generate({
      eventIds: tooManyIds,
    })
  ).rejects.toThrow('Maximum 100 events per batch')
})
```

**Key Points:**
- Tests input validation at the boundary
- Zod schema validates before handler runs
- Error message is specific and helpful

## Example 6: Metrics Calculation

```typescript
it('returns metrics with real database data', async () => {
  // ARRANGE: Create test projects and rules with statistics
  const proj1 = await createTestProject(user1.id, 'Engineering')
  const proj2 = await createTestProject(user1.id, 'Marketing')

  // Create rules with suggestion/match statistics
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

  // Mock debug info with calculated values
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
  await prisma.timesheetEntry.create({
    data: {
      userId: user1.id,
      eventId: event1.id,
      projectId: proj1.id,
      date: new Date(),
      duration: 60,
    },
  })

  // ACT: Get metrics
  const caller = suggestionsRouter.createCaller(ctx1)
  const result = await caller.metrics()

  // ASSERT: Verify all metrics are returned correctly
  expect(result).toHaveProperty('accuracyRate')
  expect(result).toHaveProperty('coverageRate')
  expect(result).toHaveProperty('activeRulesCount')
  expect(result).toHaveProperty('rulesByType')
  expect(result.accuracyRate).toBe((9 + 16 + 3) / (10 + 20 + 5))
  expect(result.activeRulesCount).toBe(3)
  expect(result.rulesByType).toEqual({
    RECURRING_EVENT_ID: 1,
    ATTENDEE_EMAIL: 1,
    TITLE_KEYWORD: 1,
  })
})
```

**Key Points:**
- Tests complex metrics calculation
- Creates realistic statistics
- Mocks learning service's debug info
- Creates real timesheet entries for coverage
- Verifies all response fields

## Example 7: Time-Based Filtering

```typescript
it('does not count old events (older than 30 days) in coverage', async () => {
  // ARRANGE: Create old event (40 days ago)
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

  // Create recent event (today)
  const recentEvent = await createTestEvent(user1.id, 'Recent Event')

  // Mock debug info
  vi.mocked(getDebugInfo).mockResolvedValue({
    totalRules: 0,
    rulesByType: {},
    overallAccuracy: 0,
    totalSuggestions: 0,
    totalMatches: 0,
    rules: [],
  })

  // ACT: Get metrics
  const caller = suggestionsRouter.createCaller(ctx1)
  const result = await caller.metrics()

  // ASSERT: Verify old event is excluded
  expect(result.coverageRate).toBe(0)
})
```

**Key Points:**
- Tests date range filtering (30-day window)
- Creates events in the past
- Verifies old events don't affect coverage
- Tests edge case of timestamp math

## Example 8: Complete User Isolation

```typescript
it('each user sees only their own metrics', async () => {
  // ARRANGE: User1 creates rules and events
  const proj1 = await createTestProject(user1.id, 'Engineering')
  await createTestRule(user1.id, proj1.id, 'TITLE_KEYWORD', 'user1', {
    totalSuggestions: 100,
    matchCount: 80,
  })

  // User2 creates different rules and events
  const proj2 = await createTestProject(user2.id, 'Marketing')
  await createTestRule(user2.id, proj2.id, 'TITLE_KEYWORD', 'user2', {
    totalSuggestions: 50,
    matchCount: 30,
  })

  // ACT & ASSERT: Query as user1
  const debugUser1 = {
    totalRules: 1,
    rulesByType: { TITLE_KEYWORD: 1 },
    overallAccuracy: 0.8,
    totalSuggestions: 100,
    totalMatches: 80,
    rules: [],
  }

  vi.mocked(getDebugInfo).mockResolvedValue(debugUser1)
  const caller1 = suggestionsRouter.createCaller(ctx1)
  const result1 = await caller1.metrics()

  expect(result1.accuracyRate).toBe(0.8)
  expect(result1.totalMatches).toBe(80)

  // ACT & ASSERT: Query as user2
  const debugUser2 = {
    totalRules: 1,
    rulesByType: { TITLE_KEYWORD: 1 },
    overallAccuracy: 0.6,
    totalSuggestions: 50,
    totalMatches: 30,
    rules: [],
  }

  vi.mocked(getDebugInfo).mockResolvedValue(debugUser2)
  const caller2 = suggestionsRouter.createCaller(ctx2)
  const result2 = await caller2.metrics()

  expect(result2.accuracyRate).toBe(0.6)
  expect(result2.totalMatches).toBe(30)
})
```

**Key Points:**
- Tests complete user isolation
- Creates data for two separate users
- Queries as both users
- Verifies each sees only their own data
- Ensures no data leakage

## Example 9: Edge Case - Empty Data

```typescript
it('returns zero metrics for new user with no data', async () => {
  // ARRANGE: User has no events, rules, or entries (handled by test setup)

  // ACT: Mock empty debug info
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

  // ASSERT: All metrics should be zero/empty
  expect(result.activeRulesCount).toBe(0)
  expect(result.accuracyRate).toBe(0)
  expect(result.coverageRate).toBe(0)
  expect(result.totalSuggestions).toBe(0)
  expect(result.totalMatches).toBe(0)
  expect(Object.keys(result.rulesByType).length).toBe(0)
})
```

**Key Points:**
- Tests graceful handling of empty data
- Verifies no errors when user has no activity
- Checks all metrics default to zero
- Ensures response structure is still valid

## Test Data Factory Pattern

The integration tests use helper functions to create test data consistently:

```typescript
// Helper functions (defined at top of test file)

async function createTestUser(email: string): Promise<TestUser> {
  return prisma.user.create({
    data: {
      email,
      hashedPassword: 'hashed_test_password',
    },
  })
}

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
      endTime: new Date(now.getTime() + 3600000),
      attendees: options.attendees || [],
      isDeleted: options.isDeleted || false,
    },
  })
}

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

function createTestContext(user: TestUser): TestContext {
  return {
    user: { id: user.id, email: user.email },
    session: {
      id: `session_${Date.now()}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  }
}
```

**Benefits of Factory Pattern:**
- Reduces duplication across tests
- Makes tests more readable
- Easy to add optional parameters
- Default values are sensible
- Single place to change schema

## Cleanup Pattern

Tests use comprehensive cleanup to ensure isolation:

```typescript
afterEach(async () => {
  // Delete in correct order to respect foreign keys
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
```

**Key Points:**
- Deletes in correct foreign key order
- Cleans both users
- Ensures next test starts fresh
- No manual cleanup needed

## Summary

The integration tests follow these patterns:

1. **AAA Pattern** - Arrange, Act, Assert structure
2. **Factory Functions** - Create test data consistently
3. **User Isolation** - Two users (user1, user2) for testing cross-user prevention
4. **Real Database** - Uses actual Prisma for realistic testing
5. **Selective Mocking** - Only mocks external services, not database
6. **Comprehensive Cleanup** - Each test leaves database clean
7. **Clear Names** - Test names describe the scenario
8. **Single Focus** - Each test verifies one behavior
9. **Assertions** - Check values and structures, not just existence
10. **Error Testing** - Both happy path and error scenarios
