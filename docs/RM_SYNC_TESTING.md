# RM Sync Aggregation Testing Guide

This document explains how to validate the RM sync aggregation refactor implementation.

## Testing Tools Overview

### 1. Automated Test Suite
**Location**: `apps/api/src/services/__tests__/rm-sync-aggregation.test.ts`

**Coverage**: 43 comprehensive tests validating security, user isolation, aggregation logic, junction table integrity, billable mapping, and change detection.

**Status**: ⚠️ Cannot run currently due to missing Vite dependency. See [Troubleshooting](#troubleshooting) for resolution.

### 2. Validation Script
**Location**: `apps/api/validate-rm-sync.ts`

**Purpose**: Command-line tool to validate live database state and implementation correctness.

**What it validates**:
- Security (HTTPS, encryption, authentication)
- User isolation (data filtering, connection ownership)
- Aggregation logic (grouping by project-day)
- Junction table integrity (component tracking)
- Billable mapping (task field conversion)
- Hash calculation (change detection)

### 3. Manual Validation Checklist
**Location**: `docs/RM_SYNC_VALIDATION.md`

**Purpose**: Comprehensive manual testing checklist for QA and user acceptance testing.

**What it includes**:
- 19 manual test scenarios
- Database validation queries
- Performance benchmarks
- Security checklist
- Integration testing procedures

## Quick Start

### Run Validation Script

```bash
# Get a user ID from your database
npx tsx apps/api/validate-rm-sync.ts <userId>

# Example
npx tsx apps/api/validate-rm-sync.ts cm5abcd1234567890
```

**Expected Output**:
```
🔍 RM Sync Aggregation Validation
👤 User ID: cm5abcd1234567890
============================================================

=== SECURITY VALIDATION ===

✅ HTTPS Enforcement
   RM API base URL uses HTTPS

✅ Token Storage
   Tokens stored encrypted in database (not in client-side storage)

✅ Parameterized Queries
   Using Prisma ORM with parameterized queries (prevents SQL injection)

✅ Input Validation
   Using Zod schemas for input validation

=== USER ISOLATION VALIDATION ===

✅ User RM Connection
   User has RM connection (ID: conn-123, RM User: 456789)

✅ Project Mappings
   Found 3 project mapping(s) for user's connection

✅ Timesheet Entry Ownership
   All timesheet entries belong to user cm5abcd1234567890

=== AGGREGATION VALIDATION ===

✅ Sample Data
   Found 42 timesheet entries to validate

✅ Aggregation Logic
   Aggregated 42 entries into 18 project-day aggregates

✅ Aggregation Rules
   All aggregates follow correct grouping rules

✅ Sample Aggregates
   Showing first 5 aggregates

=== JUNCTION TABLE VALIDATION ===

✅ Synced Entries
   Found 15 synced entries to validate

✅ Junction Table Integrity
   All 15 synced entries have valid component relationships

✅ Sample Junction Data
   Showing first synced entry with components

=== BILLABLE MAPPING VALIDATION ===

✅ Billable=true Mapping
   isBillable=true correctly maps to "Billable"

✅ Billable=false Mapping
   isBillable=false correctly maps to "Business Development"

=== HASH CALCULATION VALIDATION ===

✅ Hash Consistency
   Identical data produces same hash

✅ Hash Change Detection (Hours)
   Different hours produces different hash

✅ Hash Change Detection (Billable)
   Different billable status produces different hash

✅ Hash Change Detection (Notes)
   Different notes produces different hash

============================================================
📊 VALIDATION SUMMARY
============================================================

✅ Passed:   18
❌ Failed:   0
⚠️  Warnings: 0

✅ ALL VALIDATIONS PASSED

📄 For complete validation checklist, see:
   docs/RM_SYNC_VALIDATION.md
```

### Run Automated Tests (when Vite is fixed)

```bash
# Run all RM aggregation tests
pnpm --filter api test rm-sync-aggregation

# Run with coverage
pnpm --filter api test:coverage rm-sync-aggregation

# Run in watch mode
pnpm --filter api test:watch rm-sync-aggregation
```

### Manual Validation

Follow the comprehensive manual testing guide:

```bash
# Open the manual validation checklist
open docs/RM_SYNC_VALIDATION.md
```

## What the Tests Validate

### Security ✅

**Requirement**: All data is sent securely by the API to RM

**Validation**:
1. ✅ All RM API calls use HTTPS (never HTTP)
2. ✅ Authentication tokens included in request headers
3. ✅ Tokens encrypted at rest (AES-256-GCM)
4. ✅ No tokens exposed in client-side storage
5. ✅ SQL injection prevented (Prisma parameterized queries)
6. ✅ XSS prevented (React auto-escaping)

**How we validate**:
- Check RM API base URL: `https://api.rm.smartsheet.com`
- Verify `Authorization: Bearer` header in network requests
- Confirm tokens stored encrypted in database
- Audit database queries for parameterization
- Review code for proper input validation

### User Isolation ✅

**Requirement**: Data is only sent to the relevant user ID account

**Validation**:
1. ✅ Timesheet entries filtered by userId
2. ✅ RM connection belongs to authenticated user
3. ✅ Project mappings belong to user's connection
4. ✅ Cannot access other users' data
5. ✅ rmUserId matches user's RM account

**How we validate**:
- Query database with WHERE userId filters
- Verify RM connection ownership
- Check project mapping isolation
- Test cross-user data access (should fail)
- Inspect RM API payloads for correct assignable_id

### Aggregation ✅

**Requirement**: Data is sent by day and project, aggregated from individual events and tasks

**Validation**:
1. ✅ Multiple entries aggregate into one per project-day
2. ✅ Grouping key: `${projectId}|${YYYY-MM-DD}`
3. ✅ Different projects on same day = separate aggregates
4. ✅ Same project on different days = separate aggregates
5. ✅ Total hours = sum of component durations
6. ✅ Junction table tracks all contributing entries
7. ✅ One RM API call per project-day (not per entry)

**How we validate**:
- Count entries vs aggregates (compression ratio)
- Verify aggregation key format
- Check junction table has all component entries
- Count RM API requests (should match aggregates, not entries)
- Validate hours calculation: `SUM(durationMinutes) / 60`

**Example**:
```
Input: 40 timesheet entries (events + manual tasks)
- Project A: 15 entries across 5 days
- Project B: 20 entries across 5 days
- Project C: 5 entries across 3 days

Output: 13 RM entries (aggregates)
- Project A: 5 aggregates (one per day)
- Project B: 5 aggregates (one per day)
- Project C: 3 aggregates (one per day)

RM API calls: 13 (NOT 40)
Junction records: 40 (tracking which entries contribute to each aggregate)
```

## Test Scenarios

### Scenario 1: Multiple Entries Same Project-Day

**Setup**:
```
Entry 1: Project Alpha, Jan 15, 2 hours (event)
Entry 2: Project Alpha, Jan 15, 3 hours (manual)
Entry 3: Project Alpha, Jan 15, 1 hour (event)
```

**Expected Result**:
- 1 aggregate created
- Total hours: 6.0
- 3 junction records
- 1 RM API call
- RM entry: assignable_id=Alpha, date=2025-01-15, hours=6.0

**Validation**:
```bash
# Run validation script
npx tsx apps/api/validate-rm-sync.ts <userId>

# Check database
psql $DATABASE_URL -c "
SELECT
  s.\"aggregationDate\",
  COUNT(c.id) as component_count,
  SUM(c.\"durationMinutes\") / 60.0 as total_hours
FROM \"RMSyncedEntry\" s
JOIN \"RMSyncedEntryComponent\" c ON c.\"rmSyncedEntryId\" = s.id
WHERE s.\"aggregationDate\" = '2025-01-15'
GROUP BY s.\"aggregationDate\";
"
```

### Scenario 2: Different Projects Same Day

**Setup**:
```
Entry 1: Project Alpha, Jan 15, 4 hours
Entry 2: Project Beta, Jan 15, 3 hours
```

**Expected Result**:
- 2 aggregates created
- 2 junction records (one per entry)
- 2 RM API calls
- RM entries:
  - assignable_id=Alpha, date=2025-01-15, hours=4.0
  - assignable_id=Beta, date=2025-01-15, hours=3.0

### Scenario 3: Billable vs Non-Billable

**Setup**:
```
Entry 1: Project Alpha, Jan 15, 4 hours, billable=true
Entry 2: Project Beta, Jan 15, 3 hours, billable=false
```

**Expected Result**:
- 2 aggregates created
- RM entries:
  - Project Alpha: task="Billable"
  - Project Beta: task="Business Development"

**Validation**:
```bash
# Check RM API payload in browser DevTools Network tab
{
  "assignable_id": 111,
  "date": "2025-01-15",
  "hours": 4.0,
  "task": "Billable"
}
```

### Scenario 4: Change Detection

**Setup**:
1. Sync entries for Project Alpha, Jan 15 (6 hours)
2. Edit entry: change 2 hours → 3 hours
3. New total: 7 hours

**Expected Result**:
- Hash changes (old hash ≠ new hash)
- Sync preview shows "Update" action
- RM entry updated to 7.0 hours
- syncVersion incremented
- lastSyncedAt updated
- New hash stored

**Validation**:
```sql
-- Check hash before and after
SELECT
  "aggregationDate",
  "lastSyncedHash",
  "syncVersion",
  "lastSyncedAt"
FROM "RMSyncedEntry"
WHERE "aggregationDate" = '2025-01-15';
```

## Database Validation Queries

### View Aggregated Data

```sql
-- Show all synced entries with component counts
SELECT
  s."aggregationDate"::date as date,
  p."name" as project,
  s."rmEntryId" as rm_entry_id,
  COUNT(c.id) as components,
  SUM(c."durationMinutes") / 60.0 as total_hours,
  s."syncVersion" as version,
  s."lastSyncedAt" as last_synced
FROM "RMSyncedEntry" s
JOIN "RMProjectMapping" m ON s."mappingId" = m.id
JOIN "Project" p ON m."projectId" = p.id
LEFT JOIN "RMSyncedEntryComponent" c ON c."rmSyncedEntryId" = s.id
GROUP BY s.id, p."name"
ORDER BY s."aggregationDate" DESC
LIMIT 20;
```

### View Junction Table

```sql
-- Show components for a specific aggregate
SELECT
  t."date",
  t."duration" / 60.0 as hours,
  t."isBillable",
  t."notes",
  t."isManual",
  t."eventId"
FROM "RMSyncedEntryComponent" c
JOIN "TimesheetEntry" t ON c."timesheetEntryId" = t.id
WHERE c."rmSyncedEntryId" = '<synced_entry_id>'
ORDER BY t."createdAt";
```

### Check for Orphans

```sql
-- Components without valid synced entry (should be 0)
SELECT COUNT(*) as orphaned_components
FROM "RMSyncedEntryComponent" c
LEFT JOIN "RMSyncedEntry" s ON c."rmSyncedEntryId" = s.id
WHERE s.id IS NULL;

-- Components without valid timesheet entry (should be 0)
SELECT COUNT(*) as invalid_references
FROM "RMSyncedEntryComponent" c
LEFT JOIN "TimesheetEntry" t ON c."timesheetEntryId" = t.id
WHERE t.id IS NULL;
```

### Aggregation Statistics

```sql
-- Show aggregation compression ratio
SELECT
  COUNT(DISTINCT s.id) as total_aggregates,
  COUNT(c.id) as total_components,
  COUNT(c.id)::float / COUNT(DISTINCT s.id) as avg_components_per_aggregate,
  (1 - COUNT(DISTINCT s.id)::float / COUNT(c.id)) * 100 as compression_ratio_percent
FROM "RMSyncedEntry" s
JOIN "RMSyncedEntryComponent" c ON c."rmSyncedEntryId" = s.id;
```

## Troubleshooting

### Issue: Cannot run automated tests

**Error**: `Cannot find package 'vite'`

**Fix**:
```bash
# Install Vite as dev dependency
pnpm add -D vite -w

# Or install all dependencies
pnpm install

# Try running tests again
pnpm --filter api test rm-sync-aggregation
```

### Issue: Validation script fails with "No RM connection found"

**Cause**: User doesn't have RM connection configured

**Fix**:
1. Log in to the app
2. Navigate to Settings → Resource Management
3. Connect your RM account
4. Run validation script again

### Issue: Preview shows wrong aggregation counts

**Check**:
1. Verify entries have valid `projectId` (not null)
2. Check timezone handling (dates should be UTC)
3. Verify aggregation key format: `${projectId}|${YYYY-MM-DD}`

**Debug**:
```typescript
// Add logging to rm-aggregation.ts
console.log('Aggregation key:', key)
console.log('Entries for key:', aggregate.contributingEntries.length)
```

### Issue: Junction records not created

**Check**:
1. Verify `createMany` call in `executeSyncEntries`
2. Check for transaction errors in logs
3. Verify foreign key constraints

**Debug**:
```sql
-- Check foreign key constraints
\d "RMSyncedEntryComponent"

-- Verify synced entry exists
SELECT * FROM "RMSyncedEntry" WHERE id = '<synced_entry_id>';

-- Verify timesheet entries exist
SELECT * FROM "TimesheetEntry" WHERE id IN ('<entry_id_1>', '<entry_id_2>');
```

### Issue: Hash doesn't detect changes

**Check**:
1. Verify hash includes: date + hours + billable + notes
2. Check hash calculation uses aggregated values
3. Verify billable status included in hash

**Test**:
```bash
# Run hash validation
npx tsx apps/api/validate-rm-sync.ts <userId>

# Look for "Hash Change Detection" tests
```

## Performance Benchmarks

### Expected Performance

**Setup**: 40 timesheet entries for one week

**Aggregation**:
- Entries: 40
- Aggregates: ~18 (depending on project distribution)
- Compression: ~55%
- Time: < 100ms

**Sync**:
- API calls: 18 (one per aggregate)
- Duration: ~2-3 seconds (with 100ms delay between calls)
- Database writes: 18 RMSyncedEntry + 40 RMSyncedEntryComponent

**Expected**:
- Preview load: < 500ms
- Sync execution: 2-4 seconds for weekly timesheet
- Database queries: O(n) complexity

## Security Checklist

Before deploying to production, verify:

- [ ] All RM API calls use HTTPS
- [ ] Authentication tokens in request headers
- [ ] Tokens encrypted at rest (AES-256-GCM)
- [ ] No tokens in client-side storage
- [ ] User isolation verified (cannot access other users' data)
- [ ] SQL injection prevented (Prisma parameterized queries)
- [ ] XSS prevented (React auto-escaping)
- [ ] Input validation (Zod schemas)
- [ ] Rate limiting configured
- [ ] Error messages don't leak sensitive data

## Sign-Off Checklist

- [ ] Automated tests pass (43/43)
- [ ] Validation script passes with no failures
- [ ] Manual validation checklist completed (19/19 tests)
- [ ] Security checklist verified
- [ ] Performance benchmarks met
- [ ] Database integrity verified (no orphans)
- [ ] User acceptance testing completed
- [ ] Documentation reviewed and accurate

**Validated by**: ___________________
**Date**: ___________________
**Environment**: [ ] Development [ ] Staging [ ] Production

## Next Steps

1. **Fix Vite dependency**: Install Vite to enable automated tests
2. **Run validation script**: Validate implementation with real data
3. **Complete manual tests**: Follow RM_SYNC_VALIDATION.md checklist
4. **Performance testing**: Test with full week of data
5. **User acceptance testing**: Have users test sync functionality
6. **Production deployment**: Deploy after all validations pass

## Resources

- **Automated Tests**: `apps/api/src/services/__tests__/rm-sync-aggregation.test.ts`
- **Validation Script**: `apps/api/validate-rm-sync.ts`
- **Manual Checklist**: `docs/RM_SYNC_VALIDATION.md`
- **Refactor Plan**: `docs/RM_AGGREGATION_REFACTOR_PLAN.md`
- **API Documentation**: `docs/API.md`
