# AI Suggestion Engine

## Overview

The AI Suggestion Engine is a rule-based learning system that automatically suggests project categorizations for calendar events. It learns from user behavior patterns to provide increasingly accurate suggestions over time.

**Success Criteria:**
- 60%+ accuracy after 3-4 weeks of usage
- Confidence-based filtering (only show suggestions with >50% confidence)
- Multi-factor rule matching (title keywords, attendees, calendar source, recurring events)
- Continuous learning from user feedback

**Tech Stack:**
- Rule-based pattern matching (not ML/LLM)
- PostgreSQL + Prisma ORM for rule storage
- tRPC for type-safe API endpoints
- React Query for frontend caching

---

## 10-Phase Implementation Plan

This document outlines the complete implementation roadmap. Each phase will be implemented incrementally with additional context provided at each stage.

### Phase 1: Data Model and Schema ✅

**Status:** COMPLETE - Schema already exists in production

**Database Model:** `CategoryRule` (see `packages/database/prisma/schema.prisma` lines 121-141)

**Fields:**
- `id` - String (CUID) - Primary key
- `userId` - String - Foreign key to User
- `ruleType` - String - Type of matching rule (enum: TITLE_KEYWORD, ATTENDEE_EMAIL, ATTENDEE_DOMAIN, CALENDAR_NAME, RECURRING_EVENT_ID)
- `condition` - String - The pattern/value to match against
- `projectId` - String - Foreign key to Project (what to suggest)
- `confidenceScore` - Float (default 0.5) - Base confidence score for this rule (0.0-1.0)
- `matchCount` - Int (default 0) - Number of times rule has been matched
- `totalSuggestions` - Int (default 0) - Total times this rule was suggested (accepted or rejected)
- `accuracy` - Float (default 0.0) - Success rate (0.0-1.0) when suggestion was accepted
- `lastMatchedAt` - DateTime (nullable) - Last time this rule was matched/suggested
- `createdAt` - DateTime - When rule was created
- `updatedAt` - DateTime - Last modified timestamp

**Indexes:**
- `@@index([userId, ruleType])` - Efficient querying of user-specific rules by type
- `@@index([userId, condition])` - Optimize lookups by condition
- `@@index([userId, projectId])` - Optimize project-specific queries

**Relationships:**
- User (one-to-many) - Rules belong to a specific user
- Project (one-to-many) - Rules suggest a specific project

**Validation:**
- `confidenceScore` range: 0.0-1.0
- `accuracy` range: 0.0-1.0
- `matchCount` >= 0
- `totalSuggestions` >= 0

---

### Phase 2: Pattern Extraction

**Goal:** Extract meaningful patterns from calendar events and user categorization behavior.

**Pattern Types:**

1. **Title Keywords** (`title_keyword` rule type)
   - Extract significant words from event titles
   - Normalize: lowercase, remove stop words, trim whitespace
   - Store as `condition` in CategoryRule
   - Examples: "standup" → "Project: Engineering", "client call" → "Project: Sales"

2. **Attendee Emails** (`attendee_email` rule type)
   - Extract attendee email addresses from calendar events
   - Normalize: lowercase, trim whitespace
   - Match full email or domain
   - Examples: "john@acme.com" → "Project: Acme Client", "@internal.com" → "Project: Internal"

3. **Calendar Source** (`calendar_name` rule type)
   - Track which Google Calendar the event came from
   - Store calendar ID as `condition`
   - Examples: "Work Calendar" → "Project: Work", "Personal Calendar" → skip categorization

4. **Recurring Event Patterns** (`recurring_event` rule type)
   - Detect recurring events by Google event ID
   - Store googleEventId as `condition`
   - Examples: Weekly standup with same ID always → "Project: Engineering"

**Implementation Details:**
- Function: `extractPatternsFromEvent(event, project)` → `Array<{ ruleType, condition }>`
- Located in: `apps/api/src/services/ai-categorization.ts`
- Called when: User categorizes an event (via `learnFromCategorization()`)

**Extraction Rules:**
- Title keywords: Extract 1-3 most significant words (skip common words like "meeting", "call")
- Attendee emails: Extract all attendee emails, prioritize external domains
- Calendar: Always extract calendar ID if available
- Recurring: Always extract googleEventId for recurring events

---

### Phase 3: Confidence Calculation

**Goal:** Calculate confidence scores for suggestions based on rule history and multiple matching factors.

**Base Confidence Formula:**
```typescript
baseConfidence = rule.confidenceScore * (1 + AI_CONFIG.learningAccuracyWeight * rule.accuracy)
```

**Multi-Rule Confidence Boosting:**
When multiple rules match the same project:
```typescript
finalConfidence = 1 - (1 - conf1) * (1 - conf2) * (1 - conf3) * ...
```

**Confidence Thresholds:**
- Minimum to show suggestion: `AI_CONFIG.minConfidenceThreshold` (0.5 = 50%)
- Minimum matches for reliable rule: `AI_CONFIG.minMatchesForRule` (3)

**Factors Affecting Confidence:**
1. **Base rule confidence** - Set when rule is created (default 0.5, stored in `confidenceScore`)
2. **Accuracy score** - Historical success rate of the rule (updated on feedback)
3. **Match count** - Number of times rule has been applied (higher = more reliable)
4. **Multiple rule matches** - Confidence boosted when multiple rules agree on same project

**Example Scenarios:**

**Scenario 1: New Rule**
- `confidenceScore = 0.5`, `accuracy = 0.0`, `matchCount = 0`, `totalSuggestions = 0`
- `baseConfidence = 0.5 * (1 + 0.3 * 0.0) = 0.5` (50%)
- Result: Suggestion shown (meets 50% threshold)

**Scenario 2: Mature, Accurate Rule**
- `confidenceScore = 0.5`, `accuracy = 0.9`, `matchCount = 20`, `totalSuggestions = 20`
- `baseConfidence = 0.5 * (1 + 0.3 * 0.9) = 0.635` (63.5%)
- Result: High-confidence suggestion

**Scenario 3: Multiple Rules Match**
- Rule 1: Title keyword "standup" → `confidenceScore = 0.6`
- Rule 2: Attendee "team@company.com" → `confidenceScore = 0.5`
- `finalConfidence = 1 - (1 - 0.6) * (1 - 0.5) = 0.8` (80%)
- Result: Very high confidence (multiple signals agree)

**Implementation Details:**
- Function: `calculateConfidence(matchingRules)` → `number`
- Located in: `apps/api/src/services/ai-categorization.ts`
- Returns: Single confidence score between 0.0-1.0

---

### Phase 4: Suggestion Generation

**Goal:** Match calendar events against learned rules and generate project suggestions.

**Matching Algorithm:**

1. **Fetch Active Rules** - Query CategoryRule table for user's rules
2. **Apply Rule Matchers** - Run each rule type matcher:
   - `matchTitleKeywords()` - Check if event title contains rule.condition
   - `matchAttendeeEmails()` - Check if any attendee matches rule.condition
   - `matchCalendarId()` - Check if event.calendarId matches rule.condition
   - `matchRecurringEvent()` - Check if event.googleEventId matches rule.condition
3. **Group by Project** - Collect all matching rules, group by projectId
4. **Calculate Confidence** - For each project, calculate combined confidence score
5. **Filter by Threshold** - Only return suggestions with confidence >= 0.5
6. **Sort by Confidence** - Return suggestions sorted by confidence (highest first)

**Matching Logic Details:**

**Title Keyword Matching:**
```typescript
// Normalize both title and condition
const normalizedTitle = event.title.toLowerCase().trim()
const normalizedKeyword = rule.condition.toLowerCase().trim()

// Check if title contains keyword (whole word match)
const matches = normalizedTitle.includes(normalizedKeyword)
```

**Attendee Email Matching:**
```typescript
// Normalize attendee emails
const attendeeEmails = event.attendees.map(e => e.toLowerCase().trim())

// Check for exact match or domain match
const matches = attendeeEmails.some(email =>
  email === rule.condition ||
  email.endsWith(`@${rule.condition}`)
)
```

**Calendar ID Matching:**
```typescript
const matches = event.calendarId === rule.condition
```

**Recurring Event Matching:**
```typescript
const matches = event.googleEventId === rule.condition && event.googleEventId !== null
```

**Output Format:**
```typescript
interface Suggestion {
  projectId: string
  projectName: string
  confidence: number
  matchingRules: Array<{
    ruleType: CategoryRuleType
    condition: string
  }>
}
```

**Implementation Details:**
- Function: `getSuggestionsForEvent(userId, event)` → `Array<Suggestion>`
- Located in: `apps/api/src/services/ai-categorization.ts`
- Called from: `project.getSuggestions` tRPC endpoint

---

### Phase 5: Learning & Feedback ✅

**Status:** COMPLETE - LearningService implemented with comprehensive test coverage (46 tests passing)

**Implementation:** `apps/api/src/services/learning.ts`

**Goal:** Automatically create and update rules when users categorize events.

**Learning Triggers:**

1. **User Categorizes Event** (via `timesheet.bulkCategorize`)
   - Extract patterns from event
   - Create new rules or update existing rules
   - Increment `matchCount` if rule was used

2. **User Accepts Suggestion**
   - Increment `matchCount`
   - Update `accuracy` score (positive feedback)
   - Formula: `newAccuracy = (accuracy * matchCount + 1) / (matchCount + 1)`

3. **User Rejects/Changes Suggestion**
   - Increment `matchCount`
   - Update `accuracy` score (negative feedback)
   - Formula: `newAccuracy = (accuracy * matchCount + 0) / (matchCount + 1)`

**Rule Creation Logic:**

```typescript
async function learnFromCategorization(
  userId: string,
  event: CalendarEvent,
  projectId: string,
  wasAutoSuggestion: boolean
) {
  // Extract patterns from event
  const patterns = extractPatternsFromEvent(event)

  // For each pattern, create or update rule
  for (const pattern of patterns) {
    const existingRule = await prisma.categoryRule.findFirst({
      where: {
        userId,
        ruleType: pattern.ruleType,
        condition: pattern.condition,
        projectId,
      },
    })

    if (existingRule) {
      // Update existing rule
      await updateRuleAccuracy(existingRule.id, wasAutoSuggestion)
    } else {
      // Create new rule
      await prisma.categoryRule.create({
        data: {
          userId,
          ruleType: pattern.ruleType,
          condition: pattern.condition,
          projectId,
          confidenceScore: 0.5, // Start with neutral confidence
          matchCount: 1,
          totalSuggestions: wasAutoSuggestion ? 1 : 0,
          accuracy: wasAutoSuggestion ? 1.0 : 0.5, // If suggestion was used, start high
          lastMatchedAt: new Date(),
        },
      })
    }
  }
}
```

**Accuracy Update Logic:**

```typescript
async function updateRuleAccuracy(
  ruleId: string,
  wasAccepted: boolean
) {
  const rule = await prisma.categoryRule.findUnique({ where: { id: ruleId } })

  // Calculate new accuracy using weighted average
  const newAccuracy = (rule.accuracy * rule.totalSuggestions + (wasAccepted ? 1 : 0)) / (rule.totalSuggestions + 1)

  await prisma.categoryRule.update({
    where: { id: ruleId },
    data: {
      matchCount: rule.matchCount + 1,
      totalSuggestions: rule.totalSuggestions + 1,
      accuracy: newAccuracy,
      lastMatchedAt: new Date(),
    },
  })
}
```

**Implemented Functions:**

1. **handleCategorizationFeedback(eventId, selectedProjectId, suggestedProjectId, userId)**
   - Main entry point for user feedback
   - Determines accept/reject/manual scenarios
   - Calls penalizeIncorrectRules and strengthenRules

2. **strengthenRules(userId, patterns, projectId, event)**
   - Creates new rules with 60% initial confidence
   - Boosts existing rules by +10% (capped at 95%)
   - Priority-based: RECURRING_EVENT_ID > ATTENDEE_EMAIL > ATTENDEE_DOMAIN > TITLE_KEYWORD > CALENDAR_NAME

3. **penalizeIncorrectRules(userId, patterns, wrongProjectId)**
   - Decreases confidence by -10% (floored at 30%)
   - Updates accuracy statistics
   - Tracks failed suggestions

4. **updateRuleAccuracy(ruleId, wasAccepted)**
   - Tracks suggestion outcomes
   - Updates matchCount and totalSuggestions
   - Calculates weighted average accuracy

**Rule Management Functions:**

5. **pruneIneffectiveRules(userId)**
   - Deletes rules with <40% accuracy after 10+ suggestions
   - Cleans up rules for deleted projects
   - Should be run as weekly background job

6. **handleProjectArchival(projectId)**
   - Logs archived project information
   - Rules remain in database (projects can be unarchived)
   - Archived projects filtered in getSuggestionsForEvent

7. **getDebugInfo(userId)**
   - Returns comprehensive statistics
   - Calculates overall accuracy metrics
   - Lists all rules with metadata

**Configuration:**
- Confidence bounds: 30% (min) to 95% (max)
- Confidence boost: +10% per correct categorization
- Confidence penalty: -10% per wrong suggestion
- Initial confidence: 60% for new rules

**Integration Requirements:**
- ✅ Export extractPatternsFromEvent in ai-categorization.ts
- ✅ Filter archived projects in getSuggestionsForEvent
- ⏳ Call handleCategorizationFeedback from timesheet.bulkCategorize (Phase 6)
- ⏳ Call handleProjectArchival from project.archive (Phase 6)
- ⏳ Schedule pruneIneffectiveRules as background job (Phase 7)

**Test Coverage:**
- 46 tests, all passing
- Test file: `apps/api/src/services/__tests__/learning.test.ts`
- Covers feedback loops, rule management, edge cases, error handling

---

### Phase 6: API Endpoints

**Goal:** Expose AI functionality via type-safe tRPC endpoints.

**Endpoints:**

**1. project.getSuggestions** (READ - Already exists as stub)
```typescript
// Input
{
  eventTitle: string
  attendees?: string[]
  calendarId?: string
  googleEventId?: string
}

// Output
Array<{
  projectId: string
  projectName: string
  confidence: number
}>

// Implementation
async query({ input, ctx }) {
  const suggestions = await getSuggestionsForEvent(ctx.user.id, input)
  return suggestions.slice(0, 3) // Limit to top 3 suggestions
}
```

**2. timesheet.bulkCategorize** (WRITE - Needs learning hook)
```typescript
// Existing mutation - add learning logic after categorization
async mutate({ input, ctx }) {
  // ... existing categorization logic ...

  // NEW: Learn from each categorization
  for (const entry of input.entries) {
    const event = await getEventById(entry.eventId)
    await learnFromCategorization(
      ctx.user.id,
      event,
      entry.projectId,
      wasAutoSuggestion: false // Manual categorization
    )
  }

  // ... rest of existing logic ...
}
```

**3. project.getLearnedRules** (NEW - Optional, for debugging)
```typescript
// Input
{
  projectId?: string
  ruleType?: CategoryRuleType
  minConfidence?: number
}

// Output
Array<{
  id: string
  ruleType: CategoryRuleType
  condition: string
  projectName: string
  confidenceScore: number
  matchCount: number
  totalSuggestions: number
  accuracy: number
  lastMatchedAt: Date | null
}>

// Implementation
async query({ input, ctx }) {
  return await prisma.categoryRule.findMany({
    where: {
      userId: ctx.user.id,
      projectId: input.projectId,
      ruleType: input.ruleType,
      confidenceScore: { gte: input.minConfidence || 0 },
    },
    include: { project: true },
  })
}
```

**Implementation Details:**
- Location: `apps/api/src/routers/project.ts` and `apps/api/src/routers/timesheet.ts`
- All endpoints use `protectedProcedure` (authentication required)
- Input validation via Zod schemas
- Type safety via tRPC inference

---

### Phase 7: Analytics and Monitoring

**Goal:** Track AI engine performance and provide insights for optimization.

**Metrics to Track:**

1. **Suggestion Acceptance Rate**
   - Track: `acceptedSuggestions / totalSuggestions`
   - Target: >60% after 3-4 weeks
   - Storage: Could use database or analytics service

2. **Average Confidence Over Time**
   - Track: Average confidence of accepted suggestions
   - Monitor: Should increase over time as rules mature

3. **Rule Performance**
   - Per rule type: Which rule types have highest accuracy?
   - Per project: Which projects are easiest/hardest to categorize?

4. **Coverage Rate**
   - Track: Percentage of events that receive suggestions
   - Target: Should increase over time

**Implementation Options:**

**Option A: Database Queries (Simple)**
```typescript
// Query existing CategoryRule data
const avgAccuracy = await prisma.categoryRule.aggregate({
  where: { userId },
  _avg: { accuracy: true }
})

const ruleTypeStats = await prisma.categoryRule.groupBy({
  by: ['ruleType'],
  where: { userId },
  _avg: { accuracy: true, confidenceScore: true },
  _count: true
})
```

**Option B: Event Log Table (Advanced)**
```prisma
model SuggestionLog {
  id            String   @id @default(cuid())
  userId        String
  eventId       String
  projectId     String
  confidence    Float
  wasAccepted   Boolean
  createdAt     DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id])
  event   CalendarEvent @relation(fields: [eventId], references: [id])
  project Project @relation(fields: [projectId], references: [id])
}
```

**Implementation Details:**
- Phase 7 is OPTIONAL for MVP
- Can use existing CategoryRule table for basic analytics
- Advanced analytics could be added later with SuggestionLog table

---

### Phase 8: Performance Optimization

**Goal:** Ensure AI engine performs efficiently at scale.

**Optimization Strategies:**

1. **Database Indexing**
   - Already indexed: `[userId, ruleType]`, `[userId, condition]`, `[userId, projectId]`
   - Consider if needed: `[userId, confidenceScore]` for filtering by confidence threshold

2. **Query Optimization**
   - Batch fetch rules for user (single query)
   - Use `Promise.all()` for parallel matching
   - Cache frequently accessed rules in memory/Redis

3. **Rule Pruning**
   - Delete rules with very low accuracy after many matches
   - Example: `accuracy < 0.2 && matchCount > 10`
   - Prevent rule table bloat

4. **Pagination for Large Rule Sets**
   - Limit rules fetched per query
   - Prioritize high-confidence rules

**Performance Targets:**
- Suggestion generation: <100ms for typical user (<100 rules)
- Learning/feedback: <50ms (async background job acceptable)
- Database queries: <50ms

**Implementation Details:**
- Monitor with logging/APM tools
- Profile slow queries with Prisma query logging
- Consider Redis caching for hot paths

---

### Phase 9: Edge Cases and Error Handling

**Goal:** Handle unusual scenarios gracefully.

**Edge Cases:**

1. **No Matching Rules**
   - Return empty suggestions array
   - Frontend shows "Select project..." with no suggestions section

2. **All Rules Below Confidence Threshold**
   - Return empty suggestions array
   - Don't show low-confidence suggestions

3. **Multiple Projects with Same Confidence**
   - Sort by project name alphabetically
   - Or prioritize by most recently used project

4. **Conflicting Rules**
   - Example: Title suggests Project A, attendee suggests Project B
   - Solution: Show both suggestions sorted by confidence

5. **Event with No Extractable Patterns**
   - Example: Event title is "Meeting" with no attendees
   - Create rule only if user repeatedly categorizes similar vague events

6. **Deleted Projects**
   - Rules pointing to deleted projects should be cleaned up
   - Add CASCADE delete or background cleanup job

7. **Rule Explosion (Too Many Rules)**
   - Limit rules per user (e.g., max 500 active rules)
   - Prune low-accuracy rules periodically

**Error Handling:**

```typescript
try {
  const suggestions = await getSuggestionsForEvent(userId, event)
  return suggestions
} catch (error) {
  // Log error for monitoring
  logger.error('AI suggestion error', { userId, eventId, error })

  // Return empty array (graceful degradation)
  // User can still manually categorize
  return []
}
```

**Implementation Details:**
- Never throw errors to frontend
- Always return empty array on failure
- Log errors for debugging
- Add monitoring alerts for high error rates

---

### Phase 10: Integration and Testing

**Goal:** Ensure AI engine integrates seamlessly with existing app and is thoroughly tested.

**Frontend Integration:**

**1. Update ProjectPicker Component**
```typescript
// Pass event data to getSuggestions query
const { data: suggestions = [] } = trpc.project.getSuggestions.useQuery(
  {
    eventTitle: event.title,
    attendees: event.attendees?.map(a => a.email) || [],
    calendarId: event.calendarId,
    googleEventId: event.googleEventId,
  },
  {
    staleTime: 5 * 60 * 1000,
    enabled: true, // Enable query
  }
)
```

**2. Display Suggestions in UI**
```typescript
{suggestions.length > 0 && (
  <Command.Group heading="Suggested">
    {suggestions.map((suggestion) => (
      <Command.Item
        key={suggestion.projectId}
        onSelect={() => handleSelect(suggestion.projectId)}
      >
        <span className="mr-2">✨</span>
        <span>{suggestion.projectName}</span>
        <span className="ml-auto text-xs text-gray-400">
          {Math.round(suggestion.confidence * 100)}%
        </span>
      </Command.Item>
    ))}
  </Command.Group>
)}
```

**3. Track Suggestion Usage**
```typescript
const handleSelect = (projectId: string, wasSuggestion: boolean) => {
  // ... existing selection logic ...

  // Track if suggestion was used (for future analytics)
  if (wasSuggestion) {
    // Could call a tracking endpoint or add to local analytics
  }
}
```

**Testing Strategy:**

**Unit Tests** (apps/api/src/services/__tests__/ai-categorization.test.ts)
- Test pattern extraction for each rule type
- Test confidence calculation formulas
- Test matching logic for each rule type
- Test learning/feedback accuracy updates

**Integration Tests**
- Test full suggestion flow (create rule → get suggestion → accept → accuracy updates)
- Test tRPC endpoints with mock database
- Test error handling and edge cases

**E2E Tests** (Optional)
- Categorize events in UI → verify suggestions appear
- Accept suggestion → verify rule accuracy improves
- Test with real calendar data

**Test Coverage Goals:**
- Core AI functions: 80%+ coverage
- API endpoints: 70%+ coverage
- Edge cases: All major scenarios covered

---

## Current Architecture Analysis

Based on codebase exploration, the following components are already in place:

### Database Schema ✅ COMPLETE
- `CategoryRule` model fully defined with enhanced fields
- All necessary fields present (ruleType, condition, confidenceScore, matchCount, totalSuggestions, accuracy, lastMatchedAt)
- `SuggestionLog` model for analytics tracking
- Proper indexes for performance: `[userId, ruleType]`, `[userId, condition]`, `[userId, projectId]`
- Relationships to User and Project models

### Configuration ✅ COMPLETE
- `AI_CONFIG` in `packages/config/index.ts`
- `minConfidenceThreshold: 0.5` (50% - balanced approach)
- `learningAccuracyWeight: 0.3`
- `minMatchesForRule: 3`

### Type Definitions ✅ COMPLETE
- `CategoryRuleType` enum in `packages/shared/index.ts`
- Five rule types defined: TITLE_KEYWORD, ATTENDEE_EMAIL, ATTENDEE_DOMAIN, CALENDAR_NAME, RECURRING_EVENT_ID
- `SuggestionOutcome` enum: ACCEPTED, REJECTED, IGNORED

### API Endpoints 🚧 STUB EXISTS
- `project.getSuggestions` endpoint exists but returns empty array
- `timesheet.bulkCategorize` exists but doesn't call learning logic
- Zod input schemas already defined

### Frontend UI ✅ PREPARED
- ProjectPicker has "Suggested" section with ✨ emoji
- UI ready to display suggestions
- Query currently disabled (`enabled: false`)

### Gaps to Fill 🔨 IMPLEMENTATION NEEDED
1. Create `apps/api/src/services/ai-categorization.ts` service
2. Implement all core functions (getSuggestions, learn, updateAccuracy)
3. Update `project.getSuggestions` to call service
4. Update `timesheet.bulkCategorize` to call learning logic
5. Update ProjectPicker to pass event data and enable query
6. Write tests

---

## Rule Types Reference

### 1. Title Keyword (`title_keyword`)
**Purpose:** Match events based on words in the title

**Examples:**
- Event: "Engineering Standup" → Rule: `condition="standup"` → Project: "Engineering"
- Event: "Client Review Meeting" → Rule: `condition="client"` → Project: "Client Work"

**Extraction Logic:**
- Normalize: lowercase, remove punctuation
- Skip stop words: "meeting", "call", "sync", "review"
- Extract 1-3 most significant words

**Matching Logic:**
- Case-insensitive substring match
- Whole word matching preferred

### 2. Attendee Email (`attendee_email`)
**Purpose:** Match events based on who attends

**Examples:**
- Event with "john@acme.com" → Rule: `condition="john@acme.com"` → Project: "Acme Corp"
- Event with any "@partner.com" → Rule: `condition="partner.com"` → Project: "Partner Work"

**Extraction Logic:**
- Extract all attendee emails
- Normalize: lowercase
- Prioritize external domains (not user's company)

**Matching Logic:**
- Exact email match OR domain match
- `attendee.email === condition` OR `attendee.email.endsWith("@" + condition)`

### 3. Calendar Name (`calendar_name`)
**Purpose:** Match events based on source calendar

**Examples:**
- Event from "Work Calendar" → Rule: `condition="cal_123abc"` → Project: "Work"
- Event from "Personal" → Rule: `condition="cal_456def"` → Skip categorization

**Extraction Logic:**
- Use Google Calendar ID (stable identifier)
- Store calendar ID, not display name

**Matching Logic:**
- Exact match: `event.calendarId === rule.condition`

### 4. Recurring Event (`recurring_event`)
**Purpose:** Match recurring events that always map to same project

**Examples:**
- Weekly standup (googleEventId="recurring_123") → always "Engineering"
- Monthly board meeting (googleEventId="recurring_456") → always "Leadership"

**Extraction Logic:**
- Use Google event ID for recurring events
- Only create rule if event is part of recurring series

**Matching Logic:**
- Exact match: `event.googleEventId === rule.condition`
- Only match if googleEventId is not null

---

## Integration Points

### Backend Services
- `ai-categorization.ts` ← Called by `project.ts` router
- `ai-categorization.ts` ← Called by `timesheet.ts` router
- `ai-categorization.ts` → Calls Prisma client for CategoryRule queries
- `ai-categorization.ts` → Uses `AI_CONFIG` from `packages/config`

### Database
- CategoryRule table (read/write)
- Project table (read - for project names)
- CalendarEvent table (read - for event details)

### Frontend
- ProjectPicker component → Calls `project.getSuggestions` query
- Events page → Categorization triggers learning via `timesheet.bulkCategorize`

---

## Configuration Reference

**Location:** `packages/config/index.ts`

```typescript
export const AI_CONFIG = {
  minConfidenceThreshold: 0.5,      // Only show suggestions with >=50% confidence
  learningAccuracyWeight: 0.3,      // 30% weight for accuracy in confidence calculation
  minMatchesForRule: 3,             // Rule needs 3+ matches to be considered "reliable"
} as const
```

**Usage in Code:**
```typescript
import { AI_CONFIG } from '@repo/config'

// Filter suggestions by confidence threshold
const suggestions = allSuggestions.filter(
  s => s.confidence >= AI_CONFIG.minConfidenceThreshold
)

// Calculate confidence with accuracy weight
const adjustedConfidence = baseConfidence * (1 + AI_CONFIG.learningAccuracyWeight * accuracy)

// Check if rule is reliable
const isReliable = rule.matchCount >= AI_CONFIG.minMatchesForRule
```

---

## Next Steps

This document outlines the complete 10-phase plan. Implementation will proceed incrementally:

1. **Phase 0** (Current): Documentation and structure setup
2. **Phase 1**: Already complete (schema exists)
3. **Phases 2-6**: Core implementation (will receive additional context at each phase)
4. **Phases 7-9**: Optimization and hardening (implemented after core is stable)
5. **Phase 10**: Integration and testing (final validation)

Each phase will be implemented with:
- Detailed implementation guidance
- Code examples
- Test cases
- Integration checkpoints

---

**Last Updated:** 2025-01-09
**Status:** Phase 0 - Documentation Complete
**Next Phase:** Phase 2 - Pattern Extraction (awaiting context)
