# Suggestions Router - Integration Tests

## Overview

This document describes the comprehensive integration tests for the `suggestionsRouter` at `/apps/api/src/routers/suggestions.ts`.

**Test File:** `/apps/api/src/routers/__tests__/suggestions.integration.test.ts`

These tests verify the complete end-to-end functionality of the suggestions system, including:
- AI suggestion generation with real database rules
- User feedback processing and learning
- Metrics calculation and reporting
- Authorization and data isolation
- Error handling and edge cases

## Test Architecture

### Key Differences from Unit Tests

| Aspect | Unit Tests | Integration Tests |
|--------|------------|-------------------|
| Database | Mocked | Real (Prisma) |
| External Services | Mocked | Learning service mocked, AI service real |
| Scope | Single function | Complete endpoint flow |
| Setup | Fast, in-memory | Slower, real database |
| Coverage | 100% of code paths | Real-world scenarios |

### Isolation Strategy

Each test:
1. Creates isolated test users (unique emails with timestamps)
2. Creates test projects, events, and rules
3. Runs assertions
4. Cleans up all created data in afterEach hook

This ensures:
- Tests don't interfere with each other
- Test database can be safely shared
- Clean state for each test run

## Test Suites

### 1. suggestions.generate - Integration Tests

**Purpose:** Verify suggestion generation with real database rules and events.

#### Test Cases

##### Happy Path
- **generates suggestions for events with matching rules** - Creates event with matching rule, verifies suggestion returned with correct project, confidence, and reasoning
- **processes batch of multiple events** - Generates suggestions for 2+ events with different rule matches
- **combines multiple matching rules with confidence calculation** - Verifies multiple rules for same project/event combine confidences correctly

##### Filtering & Exclusion
- **excludes events with low-confidence suggestions** - Rules below 50% threshold are filtered out
- **returns empty map when no rules match** - Events without matching rules excluded from response
- **excludes archived projects from suggestions** - Archived projects never suggested even if high confidence

##### Error Handling
- **throws NOT_FOUND when event does not exist** - Requesting non-existent event ID
- **throws NOT_FOUND when event belongs to different user** - Cross-user access prevention
- **ignores deleted events** - Soft-deleted events treated as not found
- **requires authentication** - Unauthenticated requests rejected
- **validates input: requires at least one event** - Empty eventIds array rejected
- **validates input: rejects more than 100 events** - Max batch size enforced

### 2. suggestions.feedback - Integration Tests

**Purpose:** Verify feedback processing and rule learning.

#### Test Cases

##### Acceptance Scenarios
- **accepts suggestion feedback** - User confirms AI suggestion
- **rejects suggestion feedback** - User overrides AI suggestion
- **submits feedback when user accepts suggestion** - Correct suggestion accepted
- **submits feedback when user rejects suggestion** - Correct suggestion rejected
- **processes manual categorization (no suggestion)** - User manually categorizes without AI

##### Error Handling
- **throws NOT_FOUND when event does not exist** - Non-existent event ID
- **throws NOT_FOUND when event belongs to different user** - Cross-user access
- **throws NOT_FOUND when selected project does not exist** - Non-existent project
- **throws NOT_FOUND when selected project belongs to different user** - Cross-user project access
- **throws NOT_FOUND when suggested project does not exist** - Non-existent suggested project
- **throws NOT_FOUND when suggested project belongs to different user** - Cross-user suggested project
- **ignores deleted events** - Soft-deleted events rejected
- **requires authentication** - Unauthenticated requests rejected
- **validates input: requires valid CUIDs** - Invalid ID format rejected

### 3. suggestions.metrics - Integration Tests

**Purpose:** Verify metrics calculation from real database state.

#### Test Cases

##### Metrics Calculation
- **returns metrics with real database data** - Calculates accuracy and coverage from actual rules
- **calculates coverage from recent events (last 30 days)** - Only counts events from last 30 days
- **does not count old events (older than 30 days) in coverage** - Events 30+ days old excluded
- **returns zero metrics for new user with no data** - Handles empty database gracefully
- **includes rule breakdown by type** - Counts rules by type (RECURRING_EVENT_ID, ATTENDEE_EMAIL, etc.)

##### Error Handling
- **handles learning service errors gracefully** - Converts service errors to TRPC errors
- **requires authentication** - Unauthenticated requests rejected

##### Data Isolation
- **does not leak data between users** - Each user sees only their own metrics
- **getDebugInfo called with correct user ID** - Verified via mock assertions

### 4. Authorization & Data Isolation Tests

**Purpose:** Ensure users cannot access each other's data.

#### Test Cases

- **prevents user1 from accessing user2 events in generate** - Cross-user event access blocked
- **prevents user1 from accessing user2 projects in feedback** - Cross-user project access blocked
- **each user sees only their own metrics** - Metrics strictly isolated by userId

### 5. Edge Cases

**Purpose:** Handle unusual but valid scenarios.

#### Test Cases

- **handles events with empty attendees list** - Suggestions work without attendees
- **handles events with no attendees** - Handles undefined attendees
- **handles large batch of events efficiently** - Processes 50 events in single batch
- **handles multiple rules for same project/event** - Combines multiple matching rules correctly

## Running the Tests

### Prerequisites

```bash
# Install dependencies
pnpm install

# Set up test database (use same DATABASE_URL as configured for testing)
export DATABASE_URL="postgresql://..."
pnpm db:migrate --skip-generate
```

### Run All Integration Tests

```bash
cd apps/api
pnpm test suggestions.integration.test.ts
```

### Run Specific Test Suite

```bash
# Run only generate tests
pnpm test suggestions.integration.test.ts -t "suggestions.generate"

# Run only feedback tests
pnpm test suggestions.integration.test.ts -t "suggestions.feedback"

# Run only metrics tests
pnpm test suggestions.integration.test.ts -t "suggestions.metrics"
```

### Run with Coverage

```bash
pnpm test suggestions.integration.test.ts --coverage
```

### Watch Mode

```bash
pnpm test suggestions.integration.test.ts --watch
```

## Test Data Setup

### Test User Creation

Each test creates isolated users with unique emails:

```typescript
const user = await createTestUser(`test_${Date.now()}@example.com`)
const ctx = createTestContext(user)
```

This ensures:
- No conflicts between parallel test runs
- Complete data isolation
- Ability to test multi-user scenarios

### Test Data Helpers

The test file provides helper functions for creating test data:

```typescript
// Create user
const user = await createTestUser('test@example.com')

// Create project
const project = await createTestProject(user.id, 'Engineering', false)

// Create calendar event
const event = await createTestEvent(user.id, 'Standup', {
  googleEventId: 'recurring_123',
  attendees: [{ email: 'team@company.com' }],
})

// Create category rule
const rule = await createTestRule(user.id, project.id, 'RECURRING_EVENT_ID', 'recurring_123', {
  confidenceScore: 0.9,
  matchCount: 5,
  accuracy: 0.95,
})

// Create test context
const ctx = createTestContext(user)
```

## Test Database Requirements

### Schema

The integration tests require a PostgreSQL database with the full schema:

- User
- Project
- CalendarEvent
- CategoryRule
- TimesheetEntry
- SuggestionLog

See `/packages/database/prisma/schema.prisma` for complete schema.

### Database Cleanup

Each test:
1. Creates fresh test data
2. Runs assertions
3. Cleans up via `afterEach` hook in this order:
   - SuggestionLog (depends on event/project)
   - TimesheetEntry (depends on event/project)
   - CategoryRule (depends on project)
   - CalendarEvent (depends on user)
   - Project (depends on user)
   - User

This order respects foreign key constraints.

## Mocking Strategy

### Services That Are Mocked

1. **Learning Service** (`apps/api/src/services/learning.ts`)
   - `handleCategorizationFeedback` - Avoids complex learning logic
   - `getDebugInfo` - Returns controlled test data for metrics

**Why Mocked:** These services have complex business logic and are tested separately in `learning.test.ts`. Mocking them here allows focusing on router logic.

### Services That Are Real

1. **AI Categorization Service** (`apps/api/src/services/ai-categorization.ts`)
   - All functions run against real database rules
   - Enables testing actual suggestion generation algorithm

**Why Real:** Critical to verify suggestions work with actual confidence calculations.

## Coverage Goals

These integration tests achieve:

- **Route Coverage:** 100% of all endpoints
- **Happy Path:** Full user workflows (categorize → learn → suggest)
- **Error Paths:** All error conditions and edge cases
- **Authorization:** Cross-user data isolation
- **Data Integrity:** Database state consistency

## Continuous Integration

### GitHub Actions Configuration

Add to `.github/workflows/test.yml`:

```yaml
- name: Run integration tests
  run: |
    cd apps/api
    pnpm test suggestions.integration.test.ts
  env:
    DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
```

### Performance Considerations

- Integration tests are slower than unit tests (real database I/O)
- Run them separately from unit tests if needed:
  ```bash
  pnpm test --exclude "**/*.integration.test.ts"  # Unit tests only
  pnpm test "**/*.integration.test.ts"             # Integration tests only
  ```

## Debugging Failed Tests

### Enable Verbose Logging

```bash
pnpm test suggestions.integration.test.ts --reporter=verbose
```

### Check Database State

When a test fails, the database state is left in that state (not cleaned up) to allow inspection:

```bash
# Connect to test database
psql $DATABASE_URL

# Check test data
SELECT * FROM "User" WHERE email LIKE 'test_%';
SELECT * FROM "CategoryRule" WHERE "userId" = 'user_id';
SELECT * FROM "CalendarEvent" WHERE "userId" = 'user_id';
```

Then manually clean up:

```sql
DELETE FROM "User" WHERE email LIKE 'test_%';
```

### Debug Single Test

```bash
pnpm test suggestions.integration.test.ts -t "generates suggestions for events with matching rules"
```

## Best Practices

### When Writing New Integration Tests

1. **Use Test Helpers** - Use `createTestUser()`, `createTestEvent()`, etc.
2. **Unique Test Data** - Use timestamps to ensure uniqueness
3. **Complete Cleanup** - Always clean up in `afterEach`
4. **Clear Names** - Test names should describe the scenario, not just the function
5. **Single Assertion Focus** - Each test verifies one behavior
6. **Meaningful Assertions** - Check values, not just existence

### When Modifying Routes

1. **Add Integration Test** - Not just unit tests
2. **Test Authorization** - Verify data isolation
3. **Test Error Cases** - Both expected and edge cases
4. **Update This Doc** - Keep documentation current

## Related Tests

- **Unit Tests:** `/apps/api/src/routers/__tests__/suggestions.test.ts` - Mocked tests for fast feedback
- **Learning Tests:** `/apps/api/src/services/__tests__/learning.test.ts` - Tests for learning service
- **AI Tests:** `/apps/api/src/services/__tests__/ai-categorization.test.ts` - Tests for AI suggestion logic

## Troubleshooting

### Test Timeouts

If tests timeout, increase Vitest timeout:

```typescript
it('slow test', async () => {
  // test code
}, 30000) // 30 second timeout
```

Or globally in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    testTimeout: 30000,
  },
})
```

### Database Connection Errors

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Check Prisma connection
cd apps/api && pnpm prisma validate
```

### Prisma Schema Mismatch

```bash
# Regenerate Prisma client
pnpm db:generate

# Verify migrations are applied
pnpm db:migrate status
```

### Flaky Tests

If tests are flaky (pass/fail inconsistently):

1. Check for race conditions in test setup
2. Verify unique data creation (timestamps)
3. Look for tests that depend on execution order
4. Consider adding `beforeEach` isolation

## Future Improvements

- Add performance benchmarks (measure suggestion generation speed)
- Test concurrent feedback submissions
- Test suggestion caching behavior
- Test suggestion suggestion expiry/staleness
- Add data validation tests
