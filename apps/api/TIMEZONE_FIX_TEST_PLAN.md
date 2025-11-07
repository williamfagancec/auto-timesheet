# Timezone Sync Fix - Test Plan

## Issue Summary
**Problem**: Users in timezones ahead of UTC (e.g., Australia/Sydney, UTC+11) were not seeing their Thursday (or current-day afternoon) events after calendar sync.

**Root Cause**: Three bugs in calendar sync logic:
1. `filterEvents()` used UTC `new Date()` instead of user's local time for filtering
2. `fetchPastEvents()` overrode the `timeMax` parameter with UTC time
3. Both functions compared event times against UTC "now" instead of user's local "now"

**Example Failure**:
- Sydney user at Thursday 12:00 PM local (Thursday 1:00 AM UTC actual)
- Event ending at Thursday 2:00 PM Sydney (Thursday 3:00 AM UTC)
- Old code: Compared `3:00 AM UTC >= 1:00 AM UTC` → Event excluded ❌
- Fixed code: Uses `getUserLocalNow("Australia/Sydney")` → Event included ✅

## Changes Made

### File: `apps/api/src/services/calendar-sync.ts`

#### Change 1: Updated `fetchPastEvents()` signature (lines 38-51)
**Before**:
```typescript
export async function fetchPastEvents(
  userId: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date = new Date() // Default to UTC now
): Promise<GoogleCalendarEvent[]> {
  const accessToken = await getValidAccessToken(userId, 'google')
  const now = new Date() // UTC

  // Ensure we don't fetch future events
  const effectiveTimeMax = timeMax > now ? now : timeMax // Override with UTC
```

**After**:
```typescript
export async function fetchPastEvents(
  userId: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date // Required parameter - caller provides user's local "now"
): Promise<GoogleCalendarEvent[]> {
  const accessToken = await getValidAccessToken(userId, 'google')

  // Use the provided timeMax directly - caller handles timezone
  const effectiveTimeMax = timeMax
```

**Why**: Removed UTC override that was discarding the correctly-calculated user local time.

---

#### Change 2: Updated `filterEvents()` signature and logic (lines 91-118)
**Before**:
```typescript
export function filterEvents(events: GoogleCalendarEvent[]): GoogleCalendarEvent[] {
  const now = new Date() // UTC

  return events.filter((event) => {
    // ...
    // Only include past events (ended before now)
    if (endTime >= now) { // Compares with UTC
      return false
    }
```

**After**:
```typescript
export function filterEvents(
  events: GoogleCalendarEvent[],
  timeMax: Date // User's local "now"
): GoogleCalendarEvent[] {
  return events.filter((event) => {
    // ...
    // Only include past events (ended before user's local "now")
    if (endTime >= timeMax) { // Compares with user's local time
      return false
    }
```

**Why**: Now accepts `timeMax` parameter instead of creating UTC `new Date()`, enabling timezone-aware filtering.

---

#### Change 3: Updated `syncUserEvents()` to pass timeMax (line 408)
**Before**:
```typescript
const filteredEvents = filterEvents(events) // Doesn't pass timeMax
```

**After**:
```typescript
const filteredEvents = filterEvents(events, timeMax) // Pass user's local time
```

**Why**: Ensures `filterEvents()` receives the user's local time for comparison.

---

## Testing Instructions

### Prerequisites
1. Ensure diagnostic tools are available:
   ```bash
   # Timezone diagnostic
   npx tsx apps/api/debug-timezone.ts [userId]

   # OAuth diagnostic
   npx tsx apps/api/oauth-diagnostic-tool.ts [userId]
   ```

2. Have a test user in a non-UTC timezone (preferably UTC+10 or higher)

### Test Case 1: Verify Timezone Storage
**Goal**: Confirm user's timezone was correctly detected during OAuth

```bash
npx tsx apps/api/debug-timezone.ts [userId]
```

**Expected Output**:
```
✅ Calendar Connection Found
   User ID: [userId]
   Timezone: Australia/Sydney (or other non-UTC timezone)
   Selected Calendars: ["calendar-id-1", "calendar-id-2"]
```

**Pass Criteria**:
- ✅ Timezone field is NOT "UTC" (unless user is actually in UTC)
- ✅ Timezone format is valid IANA (e.g., "Australia/Sydney", "America/New_York")

---

### Test Case 2: Verify Time Calculations
**Goal**: Ensure `getUserLocalNow()` correctly calculates user's local time

**From diagnostic output**:
```
⏰ Time Calculations:
   Current UTC time:        2025-11-06T01:00:00.000Z (1730857200000)
   User's local time (Australia/Sydney): 2025-11-06T12:00:00.000Z (1730896800000)
   Start of week (Monday):  2025-11-04T00:00:00.000Z
```

**Pass Criteria**:
- ✅ User's local time is 11 hours ahead of UTC (for Sydney)
- ✅ Both timestamps are valid ISO strings
- ✅ Time difference matches expected timezone offset

---

### Test Case 3: Verify fetchPastEvents() No Longer Overrides timeMax
**Goal**: Confirm `effectiveTimeMax` equals user's local time, NOT UTC

**From diagnostic output**:
```
⚠️  fetchPastEvents() Override Check:
   Input timeMax:     2025-11-06T12:00:00.000Z
   UTC now:           2025-11-06T01:00:00.000Z
   Effective timeMax: 2025-11-06T12:00:00.000Z
   ✅ No override
```

**Pass Criteria**:
- ✅ "Effective timeMax" equals "Input timeMax"
- ✅ Message shows "✅ No override"
- ❌ FAIL if "❌ BUG: timeMax was overridden with UTC time!"

---

### Test Case 4: Verify Event Filtering
**Goal**: Ensure events are correctly classified as past/future based on user's timezone

**From diagnostic output**:
```
📅 Recent Events:
   Team Standup
      Start: 2025-11-06T00:00:00.000Z
      End:   2025-11-06T00:30:00.000Z
      Past (UTC):        ✅
      Past (User Local): ✅

   Client Meeting
      Start: 2025-11-06T02:00:00.000Z
      End:   2025-11-06T03:00:00.000Z
      Past (UTC):        ❌
      Past (User Local): ✅
      ⚠️  MISMATCH: Event appears past in user's timezone but future in UTC
```

**Before Fix**: Events with MISMATCH would be excluded (missing from timesheet)
**After Fix**: All events showing "Past (User Local): ✅" should be included

**Pass Criteria**:
- ✅ No events have MISMATCH warnings
- ✅ Events ending before user's local time are marked "Past (User Local): ✅"
- ✅ Events ending after user's local time are marked "Past (User Local): ❌"

---

### Test Case 5: End-to-End Sync Test
**Goal**: Verify Thursday afternoon events appear after manual sync

**Steps**:
1. Create a calendar event for Thursday 2:00-3:00 PM in user's timezone
2. Wait until Thursday 12:00 PM (noon) local time
3. Trigger manual sync via frontend `/events` page
4. Check database for event

**Database Query**:
```sql
SELECT
  id,
  title,
  "startTime",
  "endTime",
  "isDeleted"
FROM "CalendarEvent"
WHERE "userId" = '[userId]'
  AND DATE("startTime") = '2025-11-06' -- Thursday
  AND "isDeleted" = false
ORDER BY "startTime" ASC;
```

**Pass Criteria**:
- ✅ Thursday 2:00 PM event appears in database
- ✅ Event shows in frontend `/events` page
- ✅ Event available for categorization in `/timesheet` page

---

### Test Case 6: Console Log Verification
**Goal**: Verify sync logs show correct timezone info

**Steps**:
1. Trigger calendar sync (manual or background job)
2. Check API logs (console output)

**Expected Logs**:
```
Syncing 2 calendars for user [userId]
User timezone: Australia/Sydney
Date range: 2025-11-04T00:00:00.000Z to 2025-11-06T12:00:00.000Z
Fetching events from calendar primary
Current UTC time: 2025-11-06T01:00:00.000Z
User's local time (Australia/Sydney): 2025-11-06T12:00:00.000Z
Fetched 15 events, 12 after filtering (timeMax: 2025-11-06T12:00:00.000Z)
Calendar primary: 8 created, 4 updated
```

**Pass Criteria**:
- ✅ "User timezone:" shows correct timezone (not UTC)
- ✅ "User's local time" is ahead of "Current UTC time" for ahead-of-UTC timezones
- ✅ "timeMax:" in filtering log matches user's local time
- ✅ Events are successfully created/updated

---

### Test Case 7: Regression Test - UTC Users
**Goal**: Ensure fix doesn't break existing UTC users

**Steps**:
1. Find a test user in UTC timezone (or create one)
2. Run diagnostic: `npx tsx apps/api/debug-timezone.ts [userId]`
3. Trigger sync

**Expected Behavior**:
- ✅ User's local time equals UTC time
- ✅ No time calculation errors
- ✅ Events sync correctly

---

## Rollback Plan

If the fix causes issues:

1. **Immediate rollback** via git:
   ```bash
   git revert HEAD
   pnpm build
   pnpm dev:api
   ```

2. **Temporary workaround**: Force all users to UTC (lossy):
   ```sql
   UPDATE "CalendarConnection" SET timezone = 'UTC';
   ```

3. **Monitor for errors**:
   - Check API logs for "Failed to convert timezone" errors
   - Watch for increased `getUserTimezone()` failures during OAuth
   - Monitor sync job failure rates in BullMQ

---

## Success Criteria Summary

- ✅ All diagnostic checks pass (no "❌" messages)
- ✅ Thursday afternoon events appear for Sydney user
- ✅ Sync logs show user's timezone being used
- ✅ No TypeScript compilation errors
- ✅ No runtime errors in production
- ✅ UTC users unaffected (regression test passes)

---

## Known Limitations

1. **Existing Users**: Users who authenticated BEFORE 2025-11-06 may still have timezone="UTC" in database
   - **Fix**: Log out and log back in with Google OAuth (timezone updates on OAuth callback)
   - **Alternative**: Manual database update: `UPDATE "CalendarConnection" SET timezone='Australia/Sydney' WHERE userId='...'`

2. **Timezone Changes**: If user travels to different timezone, app won't auto-update
   - **Fix**: Log out and log back in
   - **Future**: Add timezone override in Settings page

3. **All-Day Events**: Still timezone-independent (this is correct behavior)

---

## Deployment Checklist

- [x] Code changes implemented
- [x] TypeScript build passes
- [x] Diagnostic tools created
- [ ] Run diagnostic on production user before deploy
- [ ] Deploy to staging environment
- [ ] Run full test suite on staging
- [ ] Monitor logs for 24 hours
- [ ] Deploy to production
- [ ] Notify affected users to re-sync

---

## Related Files

- `/Users/williamfagan/Desktop/claudeCode/time-tracker/apps/api/src/services/calendar-sync.ts` - Main fix
- `/Users/williamfagan/Desktop/claudeCode/time-tracker/apps/api/src/services/google-calendar.ts` - `getUserTimezone()` function
- `/Users/williamfagan/Desktop/claudeCode/time-tracker/apps/api/src/routers/auth.ts` - OAuth callback (stores timezone)
- `/Users/williamfagan/Desktop/claudeCode/time-tracker/apps/api/debug-timezone.ts` - Diagnostic tool
- `/Users/williamfagan/Desktop/claudeCode/time-tracker/packages/database/prisma/schema.prisma` - CalendarConnection.timezone field

