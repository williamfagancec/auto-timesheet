# API Documentation

## Overview

This document describes the tRPC API endpoints for the Auto Timesheet application, with a focus on the AI Suggestion Engine endpoints.

All endpoints use tRPC for end-to-end type safety and are organized into routers by domain.

---

## Authentication

All API endpoints require authentication via Lucia Auth session cookies. Unauthenticated requests will receive a `UNAUTHORIZED` error.

**Session Cookie:** `auth_session`
- httpOnly: true
- sameSite: 'lax'
- secure: true (production)

---

## Router Organization

```
/trpc
├── /auth           - Authentication endpoints (login, signup, OAuth)
├── /calendar       - Calendar integration (list, sync, status)
├── /project        - Project management and AI suggestions
├── /timesheet      - Timesheet entries and categorization
└── /rm             - Resource Management (RM) integration and sync
```

---

## AI Suggestion Engine Endpoints

### project.getSuggestions

Get AI-generated project suggestions for a calendar event.

**Type:** Query (read-only)

**Input:**
```typescript
{
  eventTitle: string           // Event title to analyze
  attendees?: string[]         // Array of attendee emails
  calendarId?: string          // Google Calendar ID
  googleEventId?: string       // Google recurring event ID (for recurring events)
}
```

**Output:**
```typescript
Array<{
  projectId: string           // Suggested project ID
  projectName: string         // Suggested project name
  confidence: number          // Confidence score (0.0-1.0)
  matchingRules?: Array<{     // Rules that triggered this suggestion
    ruleType: CategoryRuleType
    condition: string
  }>
}>
```

**Logic:**
1. Fetch user's CategoryRule records from database
2. Match event against each rule type (title, attendees, calendar, recurring)
3. Group matching rules by projectId
4. Calculate combined confidence score for each project
5. Filter by `AI_CONFIG.minConfidenceThreshold` (0.5)
6. Sort by confidence (highest first)
7. Return top 3 suggestions

**Example Request:**
```typescript
const suggestions = await trpc.project.getSuggestions.query({
  eventTitle: "Engineering Standup",
  attendees: ["team@company.com"],
  calendarId: "primary",
})

// Response:
// [
//   {
//     projectId: "clx123abc",
//     projectName: "Engineering",
//     confidence: 0.85,
//     matchingRules: [
//       { ruleType: "TITLE_KEYWORD", condition: "standup" },
//       { ruleType: "ATTENDEE_EMAIL", condition: "team@company.com" }
//     ]
//   }
// ]
```

**Errors:**
- `UNAUTHORIZED` - User not authenticated
- Returns empty array `[]` on internal errors (graceful degradation)

**Status:** Stub exists, returns empty array. Implementation needed in Phase 4.

---

### project.getLearnedRules (Optional)

Get learned categorization rules for debugging and analytics.

**Type:** Query (read-only)

**Input:**
```typescript
{
  projectId?: string           // Filter by specific project
  ruleType?: CategoryRuleType  // Filter by rule type
  minConfidence?: number       // Filter by minimum confidence (default 0)
}
```

**Output:**
```typescript
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
  createdAt: Date
}>
```

**Example Request:**
```typescript
const rules = await trpc.project.getLearnedRules.query({
  projectId: "clx123abc",
  minConfidence: 0.6,
})
```

**Status:** Not implemented. Optional for debugging.

---

### timesheet.bulkCategorize (Enhanced)

Categorize multiple calendar events with projects. **Enhanced in Phase 5 to include AI learning.**

**Type:** Mutation (write)

**Input:**
```typescript
{
  entries: Array<{
    eventId: string
    projectId: string
    notes?: string
    wasAutoSuggestion?: boolean  // NEW: Track if suggestion was used
  }>
}
```

**Output:**
```typescript
{
  success: boolean
  created: number
  updated: number
  errors: Array<{
    eventId: string
    error: string
  }>
}
```

**Logic (Phase 5 Enhancement):**
1. **Validate** all events and projects belong to user
2. **Create/update** TimesheetEntry records (existing logic)
3. **NEW: Learn from categorization** for each entry:
   - Extract patterns from event (title keywords, attendees, calendar, recurring ID)
   - Create or update CategoryRule records
   - Increment matchCount if suggestion was used
   - Update accuracy score based on wasAutoSuggestion flag
4. **Increment** project useCount and update lastUsedAt
5. Return success/error counts

**Example Request:**
```typescript
const result = await trpc.timesheet.bulkCategorize.mutate({
  entries: [
    {
      eventId: "evt_123",
      projectId: "proj_abc",
      wasAutoSuggestion: true,  // User accepted AI suggestion
    },
    {
      eventId: "evt_456",
      projectId: "proj_def",
      wasAutoSuggestion: false, // User manually selected
    }
  ]
})
```

**Status:** Existing mutation works. Learning logic to be added in Phase 5.

---

### suggestionLog.create (Phase 7 - Analytics)

Log suggestion outcomes for analytics and learning.

**Type:** Mutation (write)

**Input:**
```typescript
{
  eventId: string
  suggestedProjectId: string
  confidence: number
  outcome: SuggestionOutcome  // ACCEPTED | REJECTED | IGNORED
}
```

**Output:**
```typescript
{
  id: string
  createdAt: Date
}
```

**Logic:**
1. Create SuggestionLog record
2. Update CategoryRule accuracy scores based on outcome
3. Return log ID

**Status:** Not implemented. Part of Phase 7 (Analytics).

---

## Existing Endpoints (Non-AI)

### auth.login

Email/password login.

**Input:**
```typescript
{ email: string, password: string }
```

**Output:**
```typescript
{ userId: string, sessionId: string }
```

---

### auth.signup

Create new user account.

**Input:**
```typescript
{ email: string, password: string, name?: string }
```

**Output:**
```typescript
{ userId: string, sessionId: string }
```

---

### auth.googleOAuth

Initiate Google OAuth flow.

**Output:**
```typescript
{ authUrl: string, state: string }
```

---

### auth.logout

End user session.

**Output:**
```typescript
{ success: boolean }
```

---

### calendar.list

List available Google Calendars.

**Output:**
```typescript
{
  calendars: Array<{
    id: string
    summary: string
    description?: string
    primary: boolean
  }>
}
```

---

### calendar.updateSelection

Select which calendars to sync.

**Input:**
```typescript
{ calendarIds: string[] }
```

**Output:**
```typescript
{ success: boolean }
```

---

### calendar.sync

Manually trigger calendar sync.

**Output:**
```typescript
{
  eventsAdded: number
  eventsUpdated: number
  eventsDeleted: number
}
```

---

### calendar.status

Get calendar connection status.

**Output:**
```typescript
{
  connected: boolean
  selectedCalendarIds: string[]
  lastSyncedAt?: Date
}
```

---

### calendar.getEventsWithStatus

Get calendar events with categorization status.

**Input:**
```typescript
{ startDate: string, endDate: string }
```

**Output:**
```typescript
Array<{
  id: string
  title: string
  startTime: Date
  endTime: Date
  attendees?: Array<{ email: string, responseStatus: string }>
  location?: string
  isCategorized: boolean
  isSkipped: boolean
  projectId?: string
  projectName?: string
}>
```

---

### project.list

List user's projects with filtering and sorting.

**Input:**
```typescript
{
  includeArchived?: boolean
  search?: string
  sortBy?: 'name' | 'lastUsedAt' | 'useCount'
  limit?: number
}
```

**Output:**
```typescript
Array<{
  id: string
  name: string
  isArchived: boolean
  lastUsedAt: Date
  useCount: number
}>
```

---

### project.create

Create a new project.

**Input:**
```typescript
{ name: string }
```

**Output:**
```typescript
{
  id: string
  name: string
  useCount: number
  lastUsedAt: Date
}
```

---

### project.update

Update project name.

**Input:**
```typescript
{ id: string, name: string }
```

**Output:**
```typescript
{
  id: string
  name: string
}
```

---

### project.archive

Archive/unarchive a project.

**Input:**
```typescript
{ id: string, isArchived: boolean }
```

**Output:**
```typescript
{ success: boolean }
```

---

### project.incrementUse

Track project usage (called when project selected).

**Input:**
```typescript
{ id: string }
```

**Output:**
```typescript
{ success: boolean }
```

---

### timesheet.getUncategorized

Get uncategorized calendar events.

**Input:**
```typescript
{ startDate: string, endDate: string }
```

**Output:**
```typescript
Array<{
  id: string
  title: string
  startTime: Date
  endTime: Date
  // ... event fields
}>
```

---

### timesheet.skipEvent

Mark event as non-work time (skip categorization).

**Input:**
```typescript
{ eventId: string }
```

**Output:**
```typescript
{ success: boolean }
```

---

### timesheet.getEntries

Get all timesheet entries for date range.

**Input:**
```typescript
{ startDate: string, endDate: string }
```

**Output:**
```typescript
Array<{
  id: string
  date: Date
  duration: number
  projectName?: string
  notes?: string
  isManual: boolean
  isSkipped: boolean
}>
```

---

### timesheet.getWeeklyGrid

Get timesheet data in grid format for weekly view.

**Input:**
```typescript
{ weekStartDate: string }
```

**Output:**
```typescript
{
  projects: Array<{
    id: string
    name: string
    dailyHours: {
      mon: number
      tue: number
      wed: number
      thu: number
      fri: number
      sat: number
      sun: number
    }
    eventHours: {
      mon: number
      // ... hours from categorized events per day
    }
    manualHours: {
      mon: number
      // ... hours from manual entries per day
    }
    notes: {
      mon: string
      // ... notes for each day
    }
    weeklyTotal: number
  }>
  dailyTotals: {
    mon: number
    tue: number
    // ... totals for each day
  }
  targetHoursPerDay: number
}
```

**Logic:**
- `dailyHours`: Total hours per day (eventHours + manualHours)
- `eventHours`: Hours from entries linked to calendar events (eventId != null)
- `manualHours`: Hours from manual entries (eventId == null)
- Used for visual indicators in UI (blue = event, orange = manual, yellow = mixed)

---

### timesheet.updateCell

Update hours/notes for a specific project/day cell.

**Input:**
```typescript
{
  projectId: string
  date: string
  hours: number
  notes?: string
  isBillable?: boolean
  phase?: string
}
```

**Output:**
```typescript
{
  success: boolean
  updatedHours: number
}
```

**Logic:**
- Deletes all existing manual entries for this project/day
- Creates new manual adjustment entry if hours differ from event-sourced hours
- Updates notes/billable/phase on first event entry if provided

---

### timesheet.resetToEvents

Reset timesheet to match categorized calendar events only. Removes all manual entries and adjustments for a given week.

**Type:** Mutation (destructive)

**Input:**
```typescript
{
  weekStartDate: string  // Must be Monday at midnight UTC (ISO datetime)
}
```

**Output:**
```typescript
{
  success: boolean
  deletedCount: number   // Number of manual entries removed
}
```

**Logic:**
1. Validates weekStartDate is a Monday (throws BAD_REQUEST if not)
2. Calculates week range (Monday to Sunday)
3. Deletes all entries where:
   - `isManual: true` OR
   - `eventId: null` (no linked calendar event)
4. Returns count of deleted entries
5. Leaves event-sourced entries (linked via eventId) intact

**Example Request:**
```typescript
const result = await trpc.timesheet.resetToEvents.mutate({
  weekStartDate: '2024-01-01T00:00:00.000Z',  // Monday
})

// Response:
// { success: true, deletedCount: 5 }
```

**Use Case:**
- User categorizes events totaling 20 hours
- User manually adds 5 hours in timesheet
- User clicks "Reset to Events"
- System removes the 5 manual hours, returns to 20 hours from events

**Auto-Sync Behavior:**
When events are recategorized (e.g., Event A moves from Project X to Project Y), the system automatically:
1. Updates the linked timesheet entry to Project Y
2. Deletes any manual adjustment entries from Project X for that date
3. Ensures timesheet dynamically reflects event categorization changes

**Errors:**
- `BAD_REQUEST` - weekStartDate is not a Monday
- `UNAUTHORIZED` - User not authenticated
- `INTERNAL_SERVER_ERROR` - Database operation failed

**Status:** Fully implemented with comprehensive test coverage.

---

### timesheet.assignEventToProject

Assign uncategorized events to a project.

**Input:**
```typescript
{
  eventIds: string[]      // 1-100 events
  projectId: string
  isBillable?: boolean
  phase?: string
}
```

**Output:**
```typescript
{
  success: boolean
  assignedCount: number
}
```

---

### rm.sync.execute

Execute time entry sync to Resource Management for a specific week.

**Type:** Mutation

**Input:**
```typescript
{
  weekStartDate: string  // ISO 8601 datetime (must be Monday at midnight UTC)
}
```

**Output:**
```typescript
{
  success: boolean
  entriesAttempted: number      // Total entries attempted to sync
  entriesSuccess: number        // Successfully synced entries
  entriesFailed: number         // Failed entries
  entriesSkipped: number        // Unchanged entries (skipped via hash)
  unmappedProjects: Array<{     // Projects without RM mappings
    id: string
    name: string
  }>
  errors: Array<{               // Per-entry errors
    entryId: string
    error: string
  }>
  syncLogId: string             // RMSyncLog record ID
}
```

**Logic:**
1. Validates weekStartDate is Monday (throws BAD_REQUEST if not)
2. Checks rate limit (max 2 syncs/minute, throws TOO_MANY_REQUESTS if exceeded)
3. Checks for concurrent sync (throws error if already running)
4. Fetches timesheet entries for the week (Monday-Sunday)
5. Filters to entries with RM project mappings
6. Calculates SHA-256 hash for each entry: `${date}_${projectId}_${hours}_${notes}`
7. Compares hashes with RMSyncedEntry records to detect changes
8. For each entry:
   - **New:** Creates entry in RM via API
   - **Changed:** Updates entry in RM via API
   - **Unchanged:** Skips (no API call)
9. Creates/updates RMSyncedEntry records with new hash
10. Creates RMSyncLog record (status: COMPLETED/PARTIAL/FAILED)
11. Returns sync result with statistics

**Error Handling:**
- Rate limit (429): Exponential backoff (2s, 4s, 8s), max 3 retries
- Auth errors: Fail fast, no retry
- Validation errors: Fail fast, no retry
- Network errors: Retry once with 2s delay
- Partial success supported (some succeed, some fail)

**Example:**
```typescript
const result = await trpc.rm.sync.execute.mutate({
  weekStartDate: '2025-11-11T00:00:00.000Z'  // Monday
})

// Response:
// {
//   success: true,
//   entriesAttempted: 25,
//   entriesSuccess: 23,
//   entriesFailed: 2,
//   entriesSkipped: 10,
//   unmappedProjects: [{ id: 'proj-123', name: 'Unmapped Project' }],
//   errors: [
//     { entryId: 'entry-456', error: 'RM validation error: invalid hours' }
//   ],
//   syncLogId: 'log-789'
// }
```

---

### rm.sync.getStatus

Get sync status for a specific week.

**Type:** Query

**Input:**
```typescript
{
  weekStartDate: string  // ISO 8601 datetime
}
```

**Output:**
```typescript
{
  lastSyncAt: string    // ISO 8601 datetime of last sync
  syncedCount: number   // Number of synced entries
} | null                // null if no synced entries for this week
```

**Logic:**
1. Fetches RMSyncedEntry records for the week
2. Returns last sync time and count
3. Returns null if no entries synced

---

### rm.sync.history

Get recent sync history logs.

**Type:** Query

**Input:**
```typescript
{
  limit?: number  // Max results (default: 10, max: 50)
}
```

**Output:**
```typescript
Array<{
  id: string
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED'
  entriesAttempted: number | null
  entriesSuccess: number | null
  entriesFailed: number | null
  entriesSkipped: number | null
  errorMessage: string | null
  startedAt: string        // ISO 8601 datetime
  completedAt: string | null  // ISO 8601 datetime
}>
```

**Logic:**
1. Fetches RMSyncLog records for user's connection
2. Sorted by startedAt descending (newest first)
3. Limited by input.limit

---

## Error Codes

All tRPC errors follow the standard error codes:

- `UNAUTHORIZED` - User not authenticated (401)
- `FORBIDDEN` - User lacks permission (403)
- `NOT_FOUND` - Resource not found (404)
- `BAD_REQUEST` - Invalid input (400)
- `INTERNAL_SERVER_ERROR` - Server error (500)
- `CONFLICT` - Duplicate resource (409)

**Error Response Format:**
```typescript
{
  code: string
  message: string
  data?: any
}
```

---

## Rate Limiting

Global rate limit: **100 requests per minute per user**

Exceeded requests receive `429 Too Many Requests` error.

---

## Type Safety

All endpoints benefit from end-to-end type safety via tRPC:

**Frontend Usage:**
```typescript
import { trpc } from '@/lib/trpc'

// TypeScript infers correct types automatically
const suggestions = await trpc.project.getSuggestions.query({
  eventTitle: "Meeting",  // ✅ Type-safe
  invalidField: 123,      // ❌ TypeScript error
})

// suggestions is typed as Array<Suggestion>
suggestions.forEach(s => {
  console.log(s.projectName)  // ✅ Auto-complete works
  console.log(s.invalid)      // ❌ TypeScript error
})
```

---

## Migration Notes

When implementing AI endpoints in Phase 4-6, existing endpoints will need minor updates:

1. **timesheet.bulkCategorize** - Add `wasAutoSuggestion` field and learning logic
2. **project.getSuggestions** - Replace empty array stub with actual AI logic
3. **calendar.getEventsWithStatus** - May need to include suggestion data

No breaking changes to existing API contracts.

---

**Last Updated:** 2025-11-16
**Status:** RM Integration Phase 3 Complete - Manual sync endpoints documented
