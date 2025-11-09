# Testing Strategy

## Overview

This document outlines the testing strategy for the Auto Timesheet application, with specific focus on testing the AI Suggestion Engine.

**Testing Philosophy:**
- Write tests incrementally as features are implemented
- Focus on critical paths and business logic
- Prioritize unit tests for AI engine functions
- Use integration tests for tRPC endpoints
- Minimal E2E tests for smoke testing

---

## Test Stack

**Unit & Integration Testing:**
- **Vitest** - Fast unit test runner (preferred for new code)
- **Prisma Test Helpers** - In-memory database for testing
- **tRPC Testing Utilities** - Test tRPC procedures without HTTP

**Mocking:**
- **Vitest Mocks** - Built-in mocking capabilities
- **Prisma Mock** - Mock database queries

**Coverage Tools:**
- **c8** (via Vitest) - Code coverage reporting
- Target: 80%+ coverage for AI engine core functions

---

## Test Organization

```
apps/api/src/
├── services/
│   ├── ai-categorization.ts         # AI engine service
│   └── __tests__/
│       └── ai-categorization.test.ts # Unit tests for AI functions
├── routers/
│   ├── project.ts
│   ├── timesheet.ts
│   └── __tests__/
│       ├── project.test.ts           # Integration tests for project endpoints
│       └── timesheet.test.ts         # Integration tests for timesheet endpoints
```

---

## AI Engine Test Cases

### Unit Tests: Pattern Extraction

**File:** `apps/api/src/services/__tests__/ai-categorization.test.ts`

#### Test: Extract Title Keywords
```typescript
describe('extractTitleKeywords', () => {
  it('extracts meaningful keywords from event title', () => {
    const title = "Engineering Team Standup"
    const keywords = extractTitleKeywords(title)

    expect(keywords).toContain("engineering")
    expect(keywords).toContain("standup")
    expect(keywords).not.toContain("team") // Stop word
  })

  it('handles empty titles', () => {
    expect(extractTitleKeywords("")).toEqual([])
  })

  it('normalizes to lowercase', () => {
    const keywords = extractTitleKeywords("CLIENT Meeting")
    expect(keywords).toContain("client")
    expect(keywords).not.toContain("CLIENT")
  })
})
```

#### Test: Extract Attendee Patterns
```typescript
describe('extractAttendeePatterns', () => {
  it('extracts email addresses', () => {
    const attendees = ["john@acme.com", "jane@internal.com"]
    const patterns = extractAttendeePatterns(attendees)

    expect(patterns).toContain("john@acme.com")
    expect(patterns).toContain("jane@internal.com")
  })

  it('extracts email domains', () => {
    const attendees = ["user1@company.com", "user2@company.com"]
    const patterns = extractAttendeePatterns(attendees)

    expect(patterns).toContain("company.com") // Domain pattern
  })

  it('handles empty attendee list', () => {
    expect(extractAttendeePatterns([])).toEqual([])
  })
})
```

---

### Unit Tests: Rule Matching

#### Test: Match Title Keywords
```typescript
describe('matchTitleKeywords', () => {
  it('matches keyword in title', () => {
    const rule = {
      ruleType: 'TITLE_KEYWORD',
      condition: 'standup',
      confidenceScore: 0.7,
    }
    const event = {
      title: "Daily Standup Meeting",
    }

    const matches = matchTitleKeywords(rule, event)
    expect(matches).toBe(true)
  })

  it('is case-insensitive', () => {
    const rule = { condition: 'client' }
    const event = { title: "CLIENT Review" }

    expect(matchTitleKeywords(rule, event)).toBe(true)
  })

  it('does not match partial words', () => {
    const rule = { condition: 'stand' }
    const event = { title: "Understanding requirements" }

    expect(matchTitleKeywords(rule, event)).toBe(false)
  })
})
```

#### Test: Match Attendee Emails
```typescript
describe('matchAttendeeEmails', () => {
  it('matches exact email', () => {
    const rule = { condition: 'john@acme.com' }
    const event = {
      attendees: [
        { email: 'john@acme.com' },
        { email: 'jane@other.com' },
      ],
    }

    expect(matchAttendeeEmails(rule, event)).toBe(true)
  })

  it('matches email domain', () => {
    const rule = { condition: 'acme.com' }
    const event = {
      attendees: [{ email: 'anyone@acme.com' }],
    }

    expect(matchAttendeeEmails(rule, event)).toBe(true)
  })

  it('handles missing attendees', () => {
    const rule = { condition: 'test@example.com' }
    const event = { attendees: null }

    expect(matchAttendeeEmails(rule, event)).toBe(false)
  })
})
```

---

### Unit Tests: Confidence Calculation

#### Test: Calculate Base Confidence
```typescript
describe('calculateConfidence', () => {
  it('calculates confidence with accuracy boost', () => {
    const rule = {
      confidenceScore: 0.5,
      accuracy: 0.8,
      matchCount: 10,
    }

    const confidence = calculateConfidence([rule])

    // Formula: 0.5 * (1 + 0.3 * 0.8) = 0.62
    expect(confidence).toBeCloseTo(0.62, 2)
  })

  it('returns base confidence for new rules', () => {
    const rule = {
      confidenceScore: 0.5,
      accuracy: 0,
      matchCount: 0,
    }

    expect(calculateConfidence([rule])).toBe(0.5)
  })
})
```

#### Test: Multi-Rule Confidence Boosting
```typescript
describe('calculateCombinedConfidence', () => {
  it('boosts confidence when multiple rules match', () => {
    const rules = [
      { confidenceScore: 0.6, accuracy: 0, matchCount: 0 },
      { confidenceScore: 0.5, accuracy: 0, matchCount: 0 },
    ]

    // Formula: 1 - (1 - 0.6) * (1 - 0.5) = 1 - 0.2 = 0.8
    const confidence = calculateCombinedConfidence(rules)

    expect(confidence).toBeCloseTo(0.8, 2)
  })

  it('returns single confidence for one rule', () => {
    const rules = [{ confidenceScore: 0.7, accuracy: 0, matchCount: 0 }]

    expect(calculateCombinedConfidence(rules)).toBe(0.7)
  })
})
```

---

### Unit Tests: Learning & Feedback

#### Test: Create Rule from Categorization
```typescript
describe('learnFromCategorization', () => {
  it('creates new rule when categorizing event', async () => {
    const event = {
      title: "Engineering Standup",
      attendees: [{ email: "team@company.com" }],
      calendarId: "primary",
    }
    const projectId = "proj_123"

    await learnFromCategorization(userId, event, projectId, false)

    const rules = await prisma.categoryRule.findMany({
      where: { userId, projectId },
    })

    expect(rules.length).toBeGreaterThan(0)
    expect(rules.some(r => r.ruleType === 'TITLE_KEYWORD')).toBe(true)
  })

  it('updates existing rule instead of duplicating', async () => {
    // Create initial rule
    await prisma.categoryRule.create({
      data: {
        userId,
        ruleType: 'TITLE_KEYWORD',
        condition: 'standup',
        projectId,
        confidenceScore: 0.5,
        matchCount: 1,
      },
    })

    // Categorize similar event again
    const event = { title: "Daily Standup" }
    await learnFromCategorization(userId, event, projectId, false)

    const rules = await prisma.categoryRule.findMany({
      where: {
        userId,
        ruleType: 'TITLE_KEYWORD',
        condition: 'standup',
        projectId,
      },
    })

    // Should update existing rule, not create duplicate
    expect(rules).toHaveLength(1)
    expect(rules[0].matchCount).toBe(2)
  })
})
```

#### Test: Update Accuracy on Feedback
```typescript
describe('updateRuleAccuracy', () => {
  it('increases accuracy when suggestion accepted', async () => {
    const rule = await prisma.categoryRule.create({
      data: {
        userId,
        projectId,
        ruleType: 'TITLE_KEYWORD',
        condition: 'meeting',
        matchCount: 4,
        accuracy: 0.5, // 2 out of 4 accepted
        totalSuggestions: 4,
      },
    })

    await updateRuleAccuracy(rule.id, true) // Accepted

    const updated = await prisma.categoryRule.findUnique({
      where: { id: rule.id },
    })

    // New accuracy: (0.5 * 4 + 1) / 5 = 3/5 = 0.6
    expect(updated.accuracy).toBeCloseTo(0.6, 2)
    expect(updated.matchCount).toBe(5)
    expect(updated.totalSuggestions).toBe(5)
  })

  it('decreases accuracy when suggestion rejected', async () => {
    const rule = await prisma.categoryRule.create({
      data: {
        userId,
        projectId,
        ruleType: 'ATTENDEE_EMAIL',
        condition: 'client@example.com',
        matchCount: 10,
        accuracy: 0.8, // 8 out of 10 accepted
        totalSuggestions: 10,
      },
    })

    await updateRuleAccuracy(rule.id, false) // Rejected

    const updated = await prisma.categoryRule.findUnique({
      where: { id: rule.id },
    })

    // New accuracy: (0.8 * 10 + 0) / 11 = 8/11 ≈ 0.727
    expect(updated.accuracy).toBeCloseTo(0.727, 2)
  })
})
```

---

### Integration Tests: getSuggestions Endpoint

**File:** `apps/api/src/routers/__tests__/project.test.ts`

```typescript
describe('project.getSuggestions', () => {
  it('returns suggestions based on learned rules', async () => {
    // Setup: Create a rule
    await prisma.categoryRule.create({
      data: {
        userId: testUser.id,
        projectId: testProject.id,
        ruleType: 'TITLE_KEYWORD',
        condition: 'standup',
        confidenceScore: 0.7,
        matchCount: 10,
        accuracy: 0.9,
      },
    })

    // Call endpoint
    const caller = createCaller({ user: testUser })
    const suggestions = await caller.project.getSuggestions({
      eventTitle: "Daily Standup Meeting",
    })

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].projectId).toBe(testProject.id)
    expect(suggestions[0].confidence).toBeGreaterThan(0.6)
  })

  it('filters out low-confidence suggestions', async () => {
    // Create low-confidence rule
    await prisma.categoryRule.create({
      data: {
        userId: testUser.id,
        projectId: testProject.id,
        ruleType: 'TITLE_KEYWORD',
        condition: 'maybe',
        confidenceScore: 0.3, // Below threshold
      },
    })

    const caller = createCaller({ user: testUser })
    const suggestions = await caller.project.getSuggestions({
      eventTitle: "Maybe a meeting",
    })

    expect(suggestions).toHaveLength(0) // Filtered out
  })

  it('limits to top 3 suggestions', async () => {
    // Create 5 rules for different projects
    for (let i = 0; i < 5; i++) {
      const project = await prisma.project.create({
        data: { userId: testUser.id, name: `Project ${i}` },
      })
      await prisma.categoryRule.create({
        data: {
          userId: testUser.id,
          projectId: project.id,
          ruleType: 'TITLE_KEYWORD',
          condition: `keyword${i}`,
          confidenceScore: 0.5 + i * 0.05, // Varying confidence
        },
      })
    }

    const caller = createCaller({ user: testUser })
    const suggestions = await caller.project.getSuggestions({
      eventTitle: "keyword0 keyword1 keyword2 keyword3 keyword4",
    })

    expect(suggestions).toHaveLength(3) // Max 3
    // Should be top 3 by confidence
    expect(suggestions[0].confidence).toBeGreaterThan(suggestions[1].confidence)
    expect(suggestions[1].confidence).toBeGreaterThan(suggestions[2].confidence)
  })
})
```

---

### Integration Tests: bulkCategorize with Learning

**File:** `apps/api/src/routers/__tests__/timesheet.test.ts`

```typescript
describe('timesheet.bulkCategorize (with learning)', () => {
  it('creates rules when categorizing events', async () => {
    const event = await prisma.calendarEvent.create({
      data: {
        userId: testUser.id,
        googleEventId: 'evt_123',
        calendarId: 'primary',
        title: 'Engineering Standup',
        startTime: new Date(),
        endTime: new Date(),
      },
    })

    const caller = createCaller({ user: testUser })
    await caller.timesheet.bulkCategorize({
      entries: [{
        eventId: event.id,
        projectId: testProject.id,
      }],
    })

    const rules = await prisma.categoryRule.findMany({
      where: { userId: testUser.id, projectId: testProject.id },
    })

    expect(rules.length).toBeGreaterThan(0)
  })

  it('tracks suggestion acceptance in rule accuracy', async () => {
    const rule = await prisma.categoryRule.create({
      data: {
        userId: testUser.id,
        projectId: testProject.id,
        ruleType: 'TITLE_KEYWORD',
        condition: 'standup',
        confidenceScore: 0.5,
        matchCount: 0,
        accuracy: 0,
      },
    })

    const event = await prisma.calendarEvent.create({
      data: {
        userId: testUser.id,
        googleEventId: 'evt_456',
        calendarId: 'primary',
        title: 'Standup',
        startTime: new Date(),
        endTime: new Date(),
      },
    })

    const caller = createCaller({ user: testUser })
    await caller.timesheet.bulkCategorize({
      entries: [{
        eventId: event.id,
        projectId: testProject.id,
        wasAutoSuggestion: true, // User accepted suggestion
      }],
    })

    const updated = await prisma.categoryRule.findUnique({
      where: { id: rule.id },
    })

    expect(updated.matchCount).toBe(1)
    expect(updated.accuracy).toBeGreaterThan(0)
  })
})
```

---

## Test Data Fixtures

**File:** `apps/api/src/__tests__/fixtures.ts`

```typescript
export const createTestUser = async () => {
  return await prisma.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      name: 'Test User',
    },
  })
}

export const createTestProject = async (userId: string, name = 'Test Project') => {
  return await prisma.project.create({
    data: {
      userId,
      name,
    },
  })
}

export const createTestEvent = async (userId: string, overrides = {}) => {
  return await prisma.calendarEvent.create({
    data: {
      userId,
      googleEventId: `evt_${Date.now()}`,
      calendarId: 'primary',
      title: 'Test Event',
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000), // 1 hour later
      ...overrides,
    },
  })
}

export const createTestRule = async (
  userId: string,
  projectId: string,
  overrides = {}
) => {
  return await prisma.categoryRule.create({
    data: {
      userId,
      projectId,
      ruleType: 'TITLE_KEYWORD',
      condition: 'test',
      confidenceScore: 0.5,
      matchCount: 0,
      accuracy: 0,
      ...overrides,
    },
  })
}
```

---

## Test Database Setup

Use in-memory SQLite for fast tests:

**File:** `apps/api/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/__tests__/**',
      ],
    },
  },
})
```

**File:** `apps/api/src/__tests__/setup.ts`

```typescript
import { beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:./test.db', // In-memory SQLite
    },
  },
})

beforeAll(async () => {
  // Run migrations
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
})

beforeEach(async () => {
  // Clear database before each test
  await prisma.suggestionLog.deleteMany()
  await prisma.categoryRule.deleteMany()
  await prisma.timesheetEntry.deleteMany()
  await prisma.calendarEvent.deleteMany()
  await prisma.project.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

export { prisma }
```

---

## Running Tests

**Run all tests:**
```bash
pnpm test
```

**Run tests in watch mode:**
```bash
pnpm test:watch
```

**Run tests with coverage:**
```bash
pnpm test:coverage
```

**Run specific test file:**
```bash
pnpm test ai-categorization.test.ts
```

---

## Coverage Goals

**Phase 1-3 (Pattern Extraction & Matching):**
- Target: 80%+ coverage
- Focus: Unit tests for all pattern extraction and matching functions

**Phase 4-5 (Suggestion & Learning):**
- Target: 75%+ coverage
- Focus: Integration tests for tRPC endpoints with database

**Phase 6+ (API & Analytics):**
- Target: 70%+ coverage
- Focus: Critical paths and error handling

---

## Testing Checklist (Per Phase)

**Phase 2: Pattern Extraction**
- [ ] Test extractTitleKeywords with various inputs
- [ ] Test extractAttendeePatterns with email/domain extraction
- [ ] Test calendar ID extraction
- [ ] Test recurring event ID extraction
- [ ] Test edge cases (empty inputs, special characters)

**Phase 3: Confidence Calculation**
- [ ] Test base confidence formula
- [ ] Test accuracy boost calculation
- [ ] Test multi-rule confidence boosting
- [ ] Test confidence threshold filtering

**Phase 4: Suggestion Generation**
- [ ] Test each rule type matcher (title, attendee, calendar, recurring)
- [ ] Test getSuggestionsForEvent integration
- [ ] Test suggestion sorting by confidence
- [ ] Test max 3 suggestions limit
- [ ] Test empty result when no matches

**Phase 5: Learning & Feedback**
- [ ] Test learnFromCategorization creates rules
- [ ] Test existing rule updates vs. new rule creation
- [ ] Test updateRuleAccuracy calculates correctly
- [ ] Test bulkCategorize calls learning logic
- [ ] Test feedback loop (accept/reject)

**Phase 6: API Endpoints**
- [ ] Test getSuggestions endpoint returns correct format
- [ ] Test getSuggestions with authentication
- [ ] Test bulkCategorize with learning enabled
- [ ] Test error handling and edge cases

---

**Last Updated:** 2025-01-09
**Status:** Phase 0 - Documentation Complete
