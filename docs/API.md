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
└── /timesheet      - Timesheet entries and categorization
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
}
```

**Output:**
```typescript
{ success: boolean }
```

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

**Last Updated:** 2025-01-09
**Status:** Phase 0 - Documentation Complete
