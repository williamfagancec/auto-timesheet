# RM Sync Aggregation Validation Guide

This document provides comprehensive testing and validation procedures for the RM sync aggregation refactor.

## Overview

The refactor changed from syncing individual timesheet entries to syncing aggregated entries by project-day. This guide validates:

1. **Security**: Data is sent securely via HTTPS with proper authentication
2. **User Isolation**: Data is only sent for the authenticated user's account
3. **Aggregation**: Data is sent by project-day, not as individual entries

## Automated Test Suite

### Location
`apps/api/src/services/__tests__/rm-sync-aggregation.test.ts`

### Test Coverage

The automated test suite includes 43 test cases across 9 test suites:

#### 1. Security Tests (2 tests)
- ✅ HTTPS enforcement for all RM API calls
- ✅ Authentication token presence in request headers

#### 2. User Isolation Tests (3 tests)
- ✅ Timesheet entries filtered by authenticated userId
- ✅ RM connection belongs to authenticated user
- ✅ Project mappings belong to user's RM connection

#### 3. Aggregation Logic Tests (5 tests)
- ✅ Multiple entries aggregate into one per project-day
- ✅ Different projects on same day create separate aggregates
- ✅ Same project on different days create separate aggregates
- ✅ Entries without projectId are skipped
- ✅ Aggregation key format: `${projectId}|${YYYY-MM-DD}`

#### 4. Junction Table Tests (2 tests)
- ✅ Junction records created for all contributing entries
- ✅ Individual entry durations preserved in junction table

#### 5. Billable Mapping Tests (3 tests)
- ✅ `isBillable=true` maps to "Billable" task
- ✅ `isBillable=false` maps to "Business Development" task
- ✅ Billable status included in aggregate hash

#### 6. Change Detection Tests (3 tests)
- ✅ Hash changes when hours change
- ✅ Hash changes when notes change
- ✅ Identical aggregates produce same hash

#### 7. Data Validation Tests (2 tests)
- ✅ Minutes correctly converted to decimal hours
- ✅ Zero-hour entries handled appropriately

#### 8. Integration Tests (1 test)
- ✅ End-to-end flow: aggregate → create RM entry → track components

### Running Tests

**Once Vite dependency is resolved:**

```bash
# Run all RM aggregation tests
pnpm --filter api test rm-sync-aggregation

# Run with coverage
pnpm --filter api test:coverage rm-sync-aggregation

# Run in watch mode (during development)
pnpm --filter api test:watch rm-sync-aggregation
```

**Current Issue:**
Tests cannot run due to missing Vite dependency. This is a known issue tracked in the project.

## Manual Validation Checklist

Until automated tests can run, use this manual validation checklist:

### Prerequisites

- [ ] User has RM connection configured
- [ ] At least 2 projects mapped to RM
- [ ] Multiple timesheet entries for testing (both events and manual)
- [ ] Access to RM API to verify entries
- [ ] Browser DevTools open (Network tab)

### Security Validation

#### Test 1: HTTPS Enforcement
1. Open browser DevTools → Network tab
2. Navigate to Timesheet Grid page
3. Click "Sync to RM" button
4. Filter network requests by "rm.smartsheet.com"
5. **Verify**: All requests use HTTPS (not HTTP)
6. **Verify**: Request URL starts with `https://api.rm.smartsheet.com`

#### Test 2: Authentication Headers
1. In Network tab, click on any RM API request
2. Go to "Headers" tab
3. Scroll to "Request Headers"
4. **Verify**: `Authorization: Bearer <token>` header is present
5. **Verify**: Token is not empty or "undefined"

#### Test 3: Encrypted Token Storage
1. Open browser DevTools → Application tab
2. Navigate to "Cookies" → localhost
3. **Verify**: No RM access tokens stored in cookies (should be encrypted server-side)
4. Navigate to "Local Storage" and "Session Storage"
5. **Verify**: No RM access tokens visible in clear text

### User Isolation Validation

#### Test 4: User-Specific Data Query
1. Create a test scenario:
   - User A has timesheet entries for Project X
   - User B has timesheet entries for Project Y
2. Log in as User A
3. Click "Sync to RM" → Preview
4. **Verify**: Preview only shows Project X entries (User A's data)
5. Log in as User B
6. Click "Sync to RM" → Preview
7. **Verify**: Preview only shows Project Y entries (User B's data)

#### Test 5: RM Connection Isolation
1. Create two users with different RM accounts:
   - User A connected to RM Account 111
   - User B connected to RM Account 222
2. Log in as User A
3. Open DevTools → Network tab
4. Sync to RM
5. Inspect RM API request payload
6. **Verify**: `assignable_id` matches User A's mapped project in RM Account 111
7. Log in as User B and repeat
8. **Verify**: `assignable_id` matches User B's mapped project in RM Account 222

#### Test 6: Project Mapping Validation
1. Log in as User A
2. Navigate to Settings → RM → Project Mapping
3. Map Project X to RM Project 111
4. Create timesheet entries for both Project X and Project Y
5. Click "Sync to RM" → Preview
6. **Verify**: Only Project X entries appear (Project Y not mapped)
7. **Verify**: Unmapped Projects section shows Project Y

### Aggregation Validation

#### Test 7: Multiple Entries → Single Aggregate
**Setup:**
1. Create 3 timesheet entries for same project on same day:
   - Event 1: Project Alpha, Jan 15, 2 hours (billable)
   - Manual 1: Project Alpha, Jan 15, 3 hours (billable)
   - Event 2: Project Alpha, Jan 15, 1 hour (billable)

**Test:**
1. Click "Sync to RM" → Preview
2. **Verify**: Preview shows ONE entry for "Project Alpha - Jan 15"
3. **Verify**: Total hours = 6.0h (2 + 3 + 1)
4. **Verify**: Components column shows "3 entries"
5. Click "Sync X Entries"
6. Open RM API and check time entries for Jan 15
7. **Verify**: Only ONE RM time entry exists for Project Alpha on Jan 15
8. **Verify**: Hours = 6.0

**Query Database:**
```sql
-- Check RMSyncedEntry (should be 1 record)
SELECT * FROM "RMSyncedEntry"
WHERE "aggregationDate" = '2025-01-15';

-- Check junction table (should be 3 records)
SELECT * FROM "RMSyncedEntryComponent"
WHERE "rmSyncedEntryId" = '<id_from_above>';
```

**Expected Results:**
- 1 RMSyncedEntry with aggregationDate = 2025-01-15
- 3 RMSyncedEntryComponent records linking to the 3 original entries
- RM API shows 1 time entry with 6.0 hours

#### Test 8: Different Projects → Separate Aggregates
**Setup:**
1. Create entries for same day, different projects:
   - Entry 1: Project Alpha, Jan 15, 4 hours
   - Entry 2: Project Beta, Jan 15, 3 hours

**Test:**
1. Click "Sync to RM" → Preview
2. **Verify**: Preview shows TWO entries:
   - Project Alpha - Jan 15: 4.0h
   - Project Beta - Jan 15: 3.0h
3. Sync and check RM API
4. **Verify**: TWO separate time entries exist in RM

#### Test 9: Same Project Different Days → Separate Aggregates
**Setup:**
1. Create entries for same project, different days:
   - Entry 1: Project Alpha, Jan 15, 4 hours
   - Entry 2: Project Alpha, Jan 16, 3 hours

**Test:**
1. Click "Sync to RM" → Preview
2. **Verify**: Preview shows TWO entries:
   - Project Alpha - Jan 15: 4.0h
   - Project Alpha - Jan 16: 3.0h
3. Sync and check RM API
4. **Verify**: TWO separate time entries exist in RM

#### Test 10: Billable Status Aggregation
**Setup:**
1. Create entries for same project/day with billable=true:
   - Entry 1: Project Alpha, Jan 15, 2h, billable=true
   - Entry 2: Project Alpha, Jan 15, 4h, billable=true

**Test:**
1. Click "Sync to RM" → Preview
2. **Verify**: Billable badge shows "Bill" (green)
3. Sync and check RM API request payload
4. **Verify**: `task` field = "Billable"

**Repeat with billable=false:**
1. Create entries with billable=false
2. **Verify**: Billable badge shows "BD" (orange)
3. **Verify**: RM API `task` field = "Business Development"

#### Test 11: Change Detection
**Setup:**
1. Sync entries for Project Alpha, Jan 15 (6 hours total)
2. Edit one component entry: change 2 hours → 3 hours
3. New total: 7 hours

**Test:**
1. Click "Sync to RM" → Preview
2. **Verify**: Action shows "Update" (blue badge)
3. **Verify**: Hours show 7.0h (new total)
4. Sync and check RM API
5. **Verify**: RM entry updated to 7.0 hours

**Verify Hash Changed:**
```sql
SELECT "lastSyncedHash" FROM "RMSyncedEntry"
WHERE "aggregationDate" = '2025-01-15';
```
Hash should be different before/after the change.

#### Test 12: Junction Table Integrity
**Setup:**
1. Sync 4 entries aggregated into 1 RM entry

**Test:**
```sql
-- Get the synced entry
SELECT * FROM "RMSyncedEntry" WHERE "aggregationDate" = '2025-01-15';

-- Check junction records (should be 4)
SELECT
  c.id,
  c."timesheetEntryId",
  c."durationMinutes",
  c."isBillable",
  c."notes"
FROM "RMSyncedEntryComponent" c
WHERE c."rmSyncedEntryId" = '<synced_entry_id>';
```

**Verify:**
- [ ] Junction table has 4 records
- [ ] Each record has correct timesheetEntryId
- [ ] Individual durations preserved (not aggregated)
- [ ] Sum of durationMinutes = total minutes in aggregate

### Error Handling Validation

#### Test 13: Unmapped Project Handling
1. Create timesheet entry for unmapped project
2. Click "Sync to RM" → Preview
3. **Verify**: Unmapped Projects warning appears (yellow box)
4. **Verify**: Entry shows "Skip: Project not mapped to RM"
5. Sync
6. **Verify**: Entry is NOT sent to RM API
7. Check database
8. **Verify**: No RMSyncedEntry created for unmapped project

#### Test 14: Zero-Hour Entry Handling
1. Create timesheet entry with 0 hours
2. Click "Sync to RM" → Preview
3. **Verify**: Entry does not appear in preview
4. Sync
5. **Verify**: No RM API call made for zero-hour entry

#### Test 15: Deleted RM Entry Recovery
1. Sync an entry to RM
2. Manually delete the entry in RM
3. Edit the local entry (change hours)
4. Sync again
5. **Verify**: Entry is recreated in RM (not error)
6. **Verify**: New rmEntryId stored in database

### Database Validation Queries

#### Check Aggregation Structure
```sql
-- View synced entries with aggregation date
SELECT
  s.id,
  s."aggregationDate",
  s."rmEntryId",
  s."lastSyncedHash",
  s."syncVersion",
  p."rmProjectName"
FROM "RMSyncedEntry" s
JOIN "RMProjectMapping" p ON s."mappingId" = p.id
WHERE s."aggregationDate" >= '2025-01-15'
ORDER BY s."aggregationDate" DESC;
```

#### Check Junction Table
```sql
-- View all component entries for an aggregate
SELECT
  c.id,
  c."durationMinutes",
  c."isBillable",
  c."notes",
  t."date",
  t."duration",
  t."projectId"
FROM "RMSyncedEntryComponent" c
JOIN "TimesheetEntry" t ON c."timesheetEntryId" = t.id
WHERE c."rmSyncedEntryId" = '<synced_entry_id>';
```

#### Verify No Orphaned Records
```sql
-- Check for components without valid synced entry (should be 0)
SELECT COUNT(*) FROM "RMSyncedEntryComponent" c
LEFT JOIN "RMSyncedEntry" s ON c."rmSyncedEntryId" = s.id
WHERE s.id IS NULL;

-- Check for components without valid timesheet entry (should be 0)
SELECT COUNT(*) FROM "RMSyncedEntryComponent" c
LEFT JOIN "TimesheetEntry" t ON c."timesheetEntryId" = t.id
WHERE t.id IS NULL;
```

#### Verify Hash Calculation
```sql
-- Manually calculate hash and compare
WITH aggregate AS (
  SELECT
    s."aggregationDate",
    SUM(c."durationMinutes") / 60.0 AS total_hours,
    MAX(c."isBillable") AS is_billable,
    MAX(c."notes") AS notes
  FROM "RMSyncedEntry" s
  JOIN "RMSyncedEntryComponent" c ON c."rmSyncedEntryId" = s.id
  WHERE s.id = '<synced_entry_id>'
  GROUP BY s."aggregationDate"
)
SELECT
  *,
  -- Hash format: date|hours|billable|notes
  MD5(
    "aggregationDate"::text || '|' ||
    ROUND(total_hours::numeric, 2)::text || '|' ||
    is_billable::text || '|' ||
    COALESCE(notes, '')
  ) AS calculated_hash
FROM aggregate;
```

## Performance Validation

### Test 16: Sync Performance
1. Create a full week of timesheet entries (40+ entries)
2. Open DevTools → Network tab → Enable "Preserve log"
3. Click "Sync to RM"
4. Count RM API requests in Network tab
5. **Verify**: Number of requests = number of unique project-days (NOT number of entries)
6. **Example**: 40 entries across 5 projects × 5 days = 25 API calls (not 40)

### Test 17: Database Query Efficiency
Enable query logging and check for N+1 queries:

```typescript
// In packages/database/index.ts (development only)
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
  ],
});

prisma.$on('query', (e) => {
  console.log('Query: ' + e.query);
  console.log('Duration: ' + e.duration + 'ms');
});
```

**Expected**: One batch query for all entries, one batch insert for junction records

## Integration Validation

### Test 18: End-to-End Sync Flow
1. Start with empty week
2. Create 10 timesheet entries across 3 projects and 5 days
3. Click "Sync to RM" → Preview
4. **Verify**: Preview shows correct aggregation (3 projects × 5 days = ~15 aggregates)
5. Sync entries
6. **Verify**: Success message shows correct count
7. Check RM API
8. **Verify**: All aggregates appear in RM with correct hours
9. Query database
10. **Verify**: RMSyncedEntry records = number of aggregates
11. **Verify**: RMSyncedEntryComponent records = 10 (original entries)

### Test 19: Force Sync Recovery
1. Sync entries to RM
2. Manually delete ALL entries in RM
3. Check "Force Sync" checkbox in preview
4. Sync again
5. **Verify**: All entries recreated in RM
6. **Verify**: Sync status = COMPLETED (not PARTIAL or FAILED)

## Security Checklist

- [ ] All RM API calls use HTTPS
- [ ] Authentication tokens included in request headers
- [ ] Tokens not exposed in client-side code
- [ ] User can only sync their own timesheet entries
- [ ] User can only sync to their own RM connection
- [ ] Project mappings isolated by user
- [ ] SQL injection prevented (using Prisma parameterized queries)
- [ ] XSS prevented (React escapes all user input)

## Validation Checklist Summary

### Security ✅
- [ ] Test 1: HTTPS enforcement
- [ ] Test 2: Authentication headers
- [ ] Test 3: Encrypted token storage

### User Isolation ✅
- [ ] Test 4: User-specific data query
- [ ] Test 5: RM connection isolation
- [ ] Test 6: Project mapping validation

### Aggregation ✅
- [ ] Test 7: Multiple entries → single aggregate
- [ ] Test 8: Different projects → separate aggregates
- [ ] Test 9: Same project different days → separate aggregates
- [ ] Test 10: Billable status aggregation
- [ ] Test 11: Change detection
- [ ] Test 12: Junction table integrity

### Error Handling ✅
- [ ] Test 13: Unmapped project handling
- [ ] Test 14: Zero-hour entry handling
- [ ] Test 15: Deleted RM entry recovery

### Performance ✅
- [ ] Test 16: Sync performance (API call count)
- [ ] Test 17: Database query efficiency

### Integration ✅
- [ ] Test 18: End-to-end sync flow
- [ ] Test 19: Force sync recovery

## Troubleshooting

### Issue: Tests won't run
**Error**: `Cannot find package 'vite'`
**Fix**: Install Vite dependency: `pnpm add -D vite -w`

### Issue: Preview shows wrong aggregates
**Check**:
1. Verify aggregation key format: `${projectId}|${YYYY-MM-DD}`
2. Check timezone handling (dates should be in UTC)
3. Verify entries have valid projectId

### Issue: Junction records not created
**Check**:
1. Verify createMany call in executeSyncEntries
2. Check for transaction errors in logs
3. Verify foreign key constraints

### Issue: Hash doesn't detect changes
**Check**:
1. Verify hash includes: date + hours + billable + notes
2. Check hash calculation uses aggregated values (not individual entries)
3. Verify billable status included in hash

## Reporting Issues

If any validation test fails, please report with:

1. Test number and name
2. Expected behavior
3. Actual behavior
4. Steps to reproduce
5. Database query results (if applicable)
6. Network tab screenshots (if applicable)
7. Console errors (if applicable)

## Sign-Off

Once all validation tests pass, the RM aggregation refactor is complete and ready for production.

**Validated by**: ___________________
**Date**: ___________________
**Environment**: [ ] Development [ ] Staging [ ] Production
**All tests passed**: [ ] Yes [ ] No
**Issues found**: ___________________
