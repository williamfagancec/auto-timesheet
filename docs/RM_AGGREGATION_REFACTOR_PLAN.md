# RM API Integration Refactoring Plan
## From Task-Level to Project-Day Aggregation

**Document Version:** 1.0
**Date:** 2024-12-14
**Status:** Planning Phase

---

## Executive Summary

**Current Behavior:**
The RM sync service sends individual timesheet entries to RM, creating one RM time entry per task/event (e.g., 30-minute meeting, 15-minute task).

**Target Behavior:**
Aggregate all task durations into a single total per project per day, including billable status and notes in the RM submission.

**Complexity:** Medium - requires schema changes, data aggregation logic, and backward compatibility migration.

**User Clarifications (2024-12-14):**
- ✅ Billable status: Boolean field (true="billable", false="business development") - already exists, no schema change needed
- ✅ Notes: Single note field per project-day aggregate - no combining logic needed
- ✅ Phase: Being removed entirely - no phase handling needed
- ✅ UI: No breakdown tooltips - simpler preview display

---

## 1. Analysis Phase

### 1.1 Current Implementation Analysis

**Current Data Flow (Individual Entries):**
```
TimesheetEntry (many)
  → Filter by project/date range
  → For each entry: Create/Update RM time entry (1:1)
  → Track in RMSyncedEntry (1:1 relationship)
```

**Current Schema Relationships:**
- `TimesheetEntry` ↔ `RMSyncedEntry` (1:1 via `timesheetEntryId`)
- `RMSyncedEntry` → `RMProjectMapping` (many:1 via `mappingId`)
- `RMSyncedEntry` stores: `rmEntryId`, `lastSyncedHash`, `syncVersion`

**Existing Fields:**
- `TimesheetEntry.isBillable` (Boolean, default: true) ✅
  - `true` = "billable" (client-facing billable work)
  - `false` = "business development" (internal investment, non-billable to client)
- `TimesheetEntry.phase` (String, optional) - **BEING REMOVED** 🗑️
- `TimesheetEntry.notes` (String, optional) ✅
- `TimesheetEntry.duration` (Int, minutes) ✅

**Current API Payload (per entry):**
```typescript
{
  assignable_id: number,  // RM project ID
  date: "YYYY-MM-DD",
  hours: number,          // decimal hours
  notes?: string          // currently sent
}
```

**Missing in RM Payload:**
- `isBillable` status ❌ (need to add to RM API call)

### 1.2 Required Implementation Analysis

**Target Data Flow (Aggregated):**
```
TimesheetEntry (many)
  → Group by (projectId, date)
  → Aggregate: sum(duration), collect(notes), determine(billable), resolve(phase)
  → For each group: Create/Update ONE RM time entry
  → Track in RMSyncedEntry (1:many relationship)
```

**Required Schema Changes:**
1. **RMSyncedEntry Relationship:** Change from 1:1 to 1:many (one RM entry ← many timesheet entries)
2. **Add Tracking Table:** New `RMSyncedEntryComponent` to track which TimesheetEntry records contribute to each RM entry
3. **Enhanced Hash:** Calculate hash from aggregated data (all contributing entries)

**Required API Payload (aggregated):**
```typescript
{
  assignable_id: number,
  date: "YYYY-MM-DD",
  hours: number,          // SUM of all entries for project-day
  notes?: string,         // Combined notes from all entries
  // RM API fields to investigate:
  billable?: boolean,     // Needs API documentation check
  phase?: string,         // Needs API documentation check (may use 'task' field)
}
```

### 1.3 Critical Decision Points

**Business Logic Decisions (RESOLVED via user input):**

1. ✅ **Billable Aggregation:** No aggregation needed - all entries for a project-day have same `isBillable` value (determined by project)

2. ✅ **Notes Aggregation:** No aggregation needed - single note field per project-day aggregate

3. ✅ **Phase Handling:** Not needed - phase field being removed entirely from system

4. ❓ **RM API Field Mapping:**
   - **CRITICAL:** Need to verify RM API actually supports `billable` boolean field
   - May need to use `task` field as string: "billable" or "business_development"
   - May need to encode billable status in notes if no native field exists

**Technical Decisions:**

5. **Backward Compatibility:**
   - **DECISION NEEDED:** Migrate all existing RMSyncedEntry records to new schema (RECOMMENDED)
   - Alternative: Archive old data, start fresh (would lose sync history)

6. **Update Detection Strategy:**
   - **DECISION:** Recalculate hash on every sync (simple, deterministic)
   - Hash components: date + totalHours + isBillable + notes
   - No need for materialized aggregates (aggregation is lightweight)

---

## 2. Subagent Architecture Design

### 2.1 Subagent Roles and Responsibilities

#### **Subagent 1: RM API Investigation Agent**
**Type:** Research
**Responsibility:** Verify RM API capabilities for billable/phase fields

**Tasks:**
1. Review RM API documentation for time entry fields
2. Test API with sample payloads including `billable`, `task`, custom fields
3. Identify correct field mapping for billable status
4. Identify correct field mapping for phase information
5. Document API limitations and workarounds
6. Create API field mapping specification document

**Output:**
- `docs/RM_API_FIELD_MAPPING.md` - Complete field mapping specification
- Decision: Use native fields OR encode in notes/task field

**Dependencies:** None (can run immediately)

---

#### **Subagent 2: Business Logic Design Agent**
**Type:** Planning
**Responsibility:** Document aggregation rules and design schema changes

**Status:** ✅ SIMPLIFIED - User input received

**Tasks:**
1. ~~Present billable aggregation options~~ → NOT NEEDED (project property)
2. ~~Present notes aggregation options~~ → NOT NEEDED (single note)
3. ~~Present phase resolution options~~ → NOT NEEDED (removing phase)
4. Document simple aggregation rules
5. Create test cases for edge scenarios
6. Design phase field removal migration
7. Define validation rules for aggregated data

**Output:**
- `docs/RM_AGGREGATION_RULES.md` - Simplified business logic (sum duration, use project billable status, single note)
- Test case specifications
- Phase removal migration plan

**Dependencies:**
- Input from RM API Investigation Agent (to know billable field availability)
- ✅ User decisions received

---

#### **Subagent 3: Schema Migration Agent**
**Type:** Implementation (Database)
**Responsibility:** Design and implement database schema changes

**Tasks:**
1. Design new `RMSyncedEntryComponent` junction table
2. Modify `RMSyncedEntry` to support 1:many relationship
3. Remove `phase` field from `TimesheetEntry` model
4. Remove `phase` field from `UserProjectDefaults` model
5. Create Prisma migration for schema changes
6. Design data migration strategy for existing records
7. Create rollback migration in case of issues
8. Add database indexes for aggregation queries
9. Update Prisma types and regenerate client

**Output:**
- New Prisma schema with updated models
- Migration files in `packages/database/prisma/migrations/`
- Data migration script: `scripts/migrate-rm-sync-entries.ts`
- Rollback script: `scripts/rollback-rm-aggregation.ts`

**Schema Design:**

```prisma
// Modified model
model RMSyncedEntry {
  id                String   @id @default(cuid())
  mappingId         String

  // RM entry details (one RM entry)
  rmEntryId         BigInt
  rmEntryUrl        String?

  // Aggregation metadata
  aggregationDate   DateTime  // Date for this aggregate
  lastSyncedAt      DateTime
  lastSyncedHash    String    // Hash of aggregated data
  syncVersion       Int      @default(1)

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  mapping           RMProjectMapping @relation(fields: [mappingId], references: [id], onDelete: Cascade)

  // NEW: One-to-many relationship
  components        RMSyncedEntryComponent[]

  // REMOVED: timesheetEntryId (no longer 1:1)

  @@unique([mappingId, aggregationDate]) // One RM entry per project-day
  @@index([mappingId])
}

// NEW: Junction table tracking which timesheet entries contribute to aggregated RM entry
model RMSyncedEntryComponent {
  id                String   @id @default(cuid())
  rmSyncedEntryId   String   // The aggregated RM entry
  timesheetEntryId  String   // One of the contributing timesheet entries

  // Contribution metadata (for debugging/auditing)
  durationMinutes   Int      // Duration this entry contributed
  isBillable        Boolean  // Billable status of this component
  phase             String?  // Phase of this component
  notes             String?  // Notes from this component

  createdAt         DateTime @default(now())

  rmSyncedEntry     RMSyncedEntry  @relation(fields: [rmSyncedEntryId], references: [id], onDelete: Cascade)
  timesheetEntry    TimesheetEntry @relation(fields: [timesheetEntryId], references: [id], onDelete: Cascade)

  @@unique([rmSyncedEntryId, timesheetEntryId]) // Each timesheet entry appears once per aggregate
  @@index([rmSyncedEntryId])
  @@index([timesheetEntryId])
}
```

**Dependencies:**
- Business Logic Design Agent (need aggregation rules before schema design)

---

#### **Subagent 4: Data Aggregation Agent**
**Type:** Implementation (Backend Service)
**Responsibility:** Implement aggregation logic in sync service

**Tasks:**
1. Create aggregation utility functions:
   - `aggregateEntriesByProjectDay(entries: TimesheetEntry[])`
   - `calculateTotalHours(entries: TimesheetEntry[])`
   - ~~`determineBillableStatus()`~~ → Use first entry's `isBillable` (all same per project)
   - ~~`combineNotes()`~~ → Single note field on aggregate
   - ~~`resolvePhase()`~~ → Phase being removed
2. Implement aggregation hash calculation (date + hours + isBillable + notes)
3. Update `previewSync()` to show aggregated entries
4. Update `executeSyncEntries()` to use aggregation
5. Handle edge cases (zero hours after aggregation, unmapped projects)
6. Add comprehensive logging for debugging

**Output:**
- `apps/api/src/services/rm-aggregation.ts` - Aggregation utilities
- Modified `apps/api/src/services/rm-sync.ts` - Updated sync logic
- Unit tests: `apps/api/src/services/__tests__/rm-aggregation.test.ts`

**Key Functions:**

```typescript
// Aggregation result type
interface AggregatedEntry {
  projectId: string
  date: Date
  totalMinutes: number
  isBillable: boolean
  phase: string | null
  notes: string | null
  contributingEntries: TimesheetEntry[]
}

// Main aggregation function
function aggregateEntriesByProjectDay(
  entries: TimesheetEntry[]
): Map<string, AggregatedEntry> {
  // Group by projectId + date
  // Apply business logic rules
  // Return aggregated entries
}

// Hash calculation for aggregated entry
function calculateAggregateHash(aggregate: AggregatedEntry): string {
  // Include: date, totalMinutes, isBillable, phase, notes
  // Must be deterministic
}
```

**Dependencies:**
- Schema Migration Agent (need new schema in place)
- Business Logic Design Agent (need aggregation rules)
- RM API Investigation Agent (need field mapping)

---

#### **Subagent 5: Sync Orchestration Agent**
**Type:** Implementation (Backend Service)
**Responsibility:** Update sync execution flow for aggregation

**Tasks:**
1. Modify `executeSyncEntries()` to:
   - Fetch timesheet entries
   - Call aggregation function
   - For each aggregate: create/update RM entry
   - Track components in `RMSyncedEntryComponent`
2. Implement change detection for aggregates:
   - If any component changed → recalculate aggregate → check hash
3. Update retry logic for rate limiting
4. Update error handling for aggregation-specific errors
5. Implement sync rollback on partial failures
6. Add transaction safety for multi-record updates

**Output:**
- Modified `apps/api/src/services/rm-sync.ts`
- Enhanced error handling and logging
- Integration tests

**Dependencies:**
- Data Aggregation Agent (need aggregation functions)
- Schema Migration Agent (need new schema)

---

#### **Subagent 6: API Router Agent**
**Type:** Implementation (Backend API)
**Responsibility:** Update tRPC endpoints and validation

**Tasks:**
1. Update `PreviewSyncInput` schema (if needed)
2. Update `rm.sync.preview` to return aggregated preview
3. Update frontend types to match aggregated response
4. Add validation for new fields (billable, phase)
5. Update error messages for aggregation-specific errors
6. Add endpoint to view aggregation breakdown (debugging)

**Output:**
- Modified `apps/api/src/routers/rm.ts`
- Updated tRPC input/output schemas
- API documentation updates in `docs/API.md`

**Dependencies:**
- Sync Orchestration Agent (need updated sync functions)

---

#### **Subagent 7: Frontend UI Agent**
**Type:** Implementation (Frontend)
**Responsibility:** Update UI components to display aggregated data

**Tasks:**
1. Update `RMSyncButton` preview modal:
   - Show aggregated hours per project-day (no tooltip breakdown needed)
   - Display billable status in preview ("Billable" vs "Business Development")
   - Show notes field
   - ~~Show phase information~~ → Phase removed
   - ~~Add tooltip showing entry breakdown~~ → User doesn't want this
2. Update sync confirmation message
3. Update success/error alerts
4. Add visual indicators for billable vs business development
5. Remove phase-related UI elements from Events page and Timesheet Grid

**Output:**
- Modified `apps/web/src/components/RMSyncButton.tsx`
- Enhanced preview table with aggregation details
- Tooltip component for entry breakdown

**UI Mockup (Preview Table):**
```
Date       | Project          | Hours | Type                  | Action
-----------|------------------|-------|-----------------------|---------
2024-12-10 | Project Alpha    | 8.0h  | Billable              | Update
2024-12-10 | Project Beta     | 4.5h  | Business Development  | Create
2024-12-11 | Project Alpha    | 7.5h  | Billable              | Skip (No changes)
```

**Dependencies:**
- API Router Agent (need updated API response types)

---

#### **Subagent 8: Data Migration Agent**
**Type:** Implementation (Migration)
**Responsibility:** Migrate existing RMSyncedEntry records to new schema

**Tasks:**
1. Create migration script that:
   - For each existing `RMSyncedEntry`:
     - Create new record with `aggregationDate` from linked `TimesheetEntry.date`
     - Create `RMSyncedEntryComponent` linking to original `TimesheetEntry`
     - Mark as "legacy" migration (metadata)
2. Handle orphaned records (TimesheetEntry deleted)
3. Validate migration completeness
4. Create verification queries to check data integrity
5. Create rollback procedure
6. Test on staging database before production

**Output:**
- `scripts/migrate-rm-sync-entries.ts` - Migration script
- `scripts/verify-rm-migration.ts` - Verification script
- `scripts/rollback-rm-migration.ts` - Rollback script
- Migration report: success/failure counts

**Migration Strategy:**
```typescript
// For each existing RMSyncedEntry (1:1 with TimesheetEntry)
// Convert to 1:many structure with single component

async function migrateExistingEntries() {
  const existingEntries = await prisma.rMSyncedEntry.findMany({
    include: { timesheetEntry: true }
  })

  for (const entry of existingEntries) {
    // Create new RMSyncedEntry (aggregated, even if just 1 component)
    const newEntry = await prisma.rMSyncedEntry.create({
      data: {
        mappingId: entry.mappingId,
        rmEntryId: entry.rmEntryId,
        aggregationDate: entry.timesheetEntry.date,
        lastSyncedAt: entry.lastSyncedAt,
        lastSyncedHash: entry.lastSyncedHash, // May need recalculation
        syncVersion: entry.syncVersion,
      }
    })

    // Create component linking to original TimesheetEntry
    await prisma.rMSyncedEntryComponent.create({
      data: {
        rmSyncedEntryId: newEntry.id,
        timesheetEntryId: entry.timesheetEntryId,
        durationMinutes: entry.timesheetEntry.duration,
        isBillable: entry.timesheetEntry.isBillable,
        phase: entry.timesheetEntry.phase,
        notes: entry.timesheetEntry.notes,
      }
    })

    // Delete old entry
    await prisma.rMSyncedEntry.delete({ where: { id: entry.id } })
  }
}
```

**Dependencies:**
- Schema Migration Agent (need new schema deployed)

---

#### **Subagent 9: Testing Agent**
**Type:** Testing
**Responsibility:** Comprehensive testing of aggregation logic

**Tasks:**
1. Write unit tests for aggregation functions:
   - Single entry aggregation (edge case)
   - Multiple entries same project-day
   - Multiple projects same day
   - Billable logic test cases
   - Notes combination test cases
   - Phase resolution test cases
2. Write integration tests for sync flow:
   - Preview aggregated entries
   - Execute sync with aggregation
   - Update detection on component change
   - Error handling
3. Write E2E tests for full sync workflow
4. Performance testing for large datasets (100+ entries)
5. Create test data generators

**Output:**
- `apps/api/src/services/__tests__/rm-aggregation.test.ts` (17+ tests)
- `apps/api/src/services/__tests__/rm-sync-aggregation.test.ts` (12+ tests)
- E2E test suite
- Performance benchmarks

**Test Cases:**

```typescript
describe('RM Aggregation Service', () => {
  describe('aggregateEntriesByProjectDay', () => {
    test('single entry aggregates to itself', () => {})
    test('multiple entries same project-day sum durations', () => {})
    test('different projects create separate aggregates', () => {})
    test('different dates create separate aggregates', () => {})
    test('all entries have same isBillable value', () => {})
    test('mixed billable values throws error', () => {}) // Should never happen in practice
  })

  describe('calculateAggregateHash', () => {
    test('deterministic hash (same input → same hash)', () => {})
    test('different duration → different hash', () => {})
    test('different billable status → different hash', () => {})
    test('different notes → different hash', () => {})
    test('same aggregate different order → same hash', () => {})
  })

  describe('Edge Cases', () => {
    test('zero hours after aggregation → skip', () => {})
    test('notes overflow → truncate', () => {})
    test('null notes → empty string', () => {})
    test('unmapped project → skip with warning', () => {})
  })
})
```

**Dependencies:**
- All implementation agents (need code to test)

---

#### **Subagent 10: Documentation Agent**
**Type:** Documentation
**Responsibility:** Update all documentation

**Tasks:**
1. Update `CLAUDE.md`:
   - Document aggregation feature in "Completed Features"
   - Update RM integration description
2. Update `docs/API.md`:
   - Document new aggregation behavior
   - Update sync endpoint documentation
   - Add examples of aggregated responses
3. Create `docs/RM_AGGREGATION_GUIDE.md`:
   - User-facing documentation
   - How aggregation works
   - Business rules explanation
   - Troubleshooting guide
4. Update code comments and JSDoc
5. Create migration guide for users

**Output:**
- Updated documentation files
- User migration guide
- Inline code documentation

**Dependencies:**
- All other agents (need complete implementation)

---

## 3. Implementation Sequence

### Phase 1: Research & Planning (2-3 days)
**Sequential Tasks:**

1. **RM API Investigation Agent** (Day 1)
   - Research RM API field capabilities
   - Test billable/phase field support
   - Document findings

2. **Business Logic Design Agent** (Day 1-2)
   - Wait for API investigation results
   - Ask user for business logic decisions
   - Document chosen rules
   - Create test specifications

**Checkpoint 1:** Review API capabilities and business rules with user

---

### Phase 2: Schema & Migration (2 days)
**Sequential Tasks:**

3. **Schema Migration Agent** (Day 3-4)
   - Design new schema based on business rules
   - Create Prisma migration
   - Add indexes
   - Test migration locally

**Checkpoint 2:** Review schema changes, test on staging database

---

### Phase 3: Core Implementation (3-4 days)
**Can run in parallel after Phase 2:**

4. **Data Aggregation Agent** (Day 5-6)
   - Implement aggregation utilities
   - Write unit tests
   - Validate against business rules

5. **Sync Orchestration Agent** (Day 6-7)
   - Update sync execution flow
   - Integrate aggregation functions
   - Handle edge cases
   - (Depends on Data Aggregation Agent functions)

6. **API Router Agent** (Day 7)
   - Update tRPC endpoints
   - Update validation schemas
   - (Depends on Sync Orchestration Agent)

**Checkpoint 3:** Integration testing of backend services

---

### Phase 4: Frontend & Migration (2 days)
**Can run in parallel:**

7. **Frontend UI Agent** (Day 8)
   - Update RMSyncButton component
   - Enhance preview modal
   - Add aggregation indicators

8. **Data Migration Agent** (Day 8-9)
   - Create migration scripts
   - Test on staging data
   - Create rollback procedures

**Checkpoint 4:** E2E testing with frontend + backend + migrated data

---

### Phase 5: Testing & Documentation (2 days)

9. **Testing Agent** (Day 10)
   - Run all test suites
   - Performance testing
   - Fix any bugs discovered

10. **Documentation Agent** (Day 10-11)
    - Update all documentation
    - Create user guides

**Checkpoint 5:** Final review and production deployment readiness

---

## 4. Data Flow Mapping

### 4.1 Current Flow (Individual Entries)

```
┌─────────────────┐
│ TimesheetEntry  │ (Many individual task entries)
└────────┬────────┘
         │ Filter by date range, project, !isSkipped
         ↓
┌─────────────────┐
│ For Each Entry  │
└────────┬────────┘
         │ Check: zero hours? unmapped project? already synced?
         ↓
┌─────────────────┐
│ RM API Call     │ Create/Update individual time entry
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ RMSyncedEntry   │ (1:1 with TimesheetEntry)
│ - rmEntryId     │
│ - lastSyncedHash│ (hash of single entry)
│ - syncVersion   │
└─────────────────┘
```

### 4.2 Target Flow (Aggregated Entries)

```
┌─────────────────┐
│ TimesheetEntry  │ (Many individual task entries)
└────────┬────────┘
         │ Filter by date range, project, !isSkipped
         ↓
┌─────────────────────────────────────────┐
│ GROUP BY (projectId, date)              │
├─────────────────────────────────────────┤
│ Aggregation Logic:                      │
│ • SUM(duration) → totalHours            │
│ • ANY(isBillable) → isBillable          │
│ • CONCAT(notes) → combinedNotes         │
│ • RESOLVE(phase) → selectedPhase        │
│ • COLLECT(entries) → componentList      │
└────────┬────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────┐
│ AggregatedEntry                         │
│ {                                       │
│   projectId, date, totalHours,          │
│   isBillable, phase, notes,             │
│   contributingEntries[]                 │
│ }                                       │
└────────┬────────────────────────────────┘
         │ For each aggregate
         ↓
┌─────────────────┐
│ Check Hash      │ Compare aggregateHash with lastSyncedHash
└────────┬────────┘
         │ If changed or new
         ↓
┌─────────────────────────────────────────┐
│ RM API Call                             │
│ POST/PUT /time_entries                  │
│ {                                       │
│   assignable_id: rmProjectId,           │
│   date: "YYYY-MM-DD",                   │
│   hours: totalHours (decimal),          │
│   notes: combinedNotes,                 │
│   [billable]: isBillable, // if supported│
│   [task/phase]: phase     // if supported│
│ }                                       │
└────────┬────────────────────────────────┘
         │ Returns rmEntryId
         ↓
┌─────────────────────────────────────────┐
│ RMSyncedEntry (1 per project-day)       │
│ - rmEntryId                             │
│ - aggregationDate                       │
│ - lastSyncedHash (aggregate hash)       │
└────────┬────────────────────────────────┘
         │ Create components
         ↓
┌─────────────────────────────────────────┐
│ RMSyncedEntryComponent (many)           │
│ For each contributing TimesheetEntry:   │
│ - rmSyncedEntryId (parent aggregate)    │
│ - timesheetEntryId (child component)    │
│ - durationMinutes (contribution)        │
│ - isBillable, phase, notes (metadata)   │
└─────────────────────────────────────────┘
```

### 4.3 Change Detection Flow

```
User edits TimesheetEntry
         │
         ↓
Find all RMSyncedEntryComponent records linking this entry
         │
         ↓
Get parent RMSyncedEntry (aggregate)
         │
         ↓
Fetch all component TimesheetEntry records
         │
         ↓
Recalculate aggregate (SUM, ANY, CONCAT, RESOLVE)
         │
         ↓
Calculate new aggregateHash
         │
         ↓
Compare with RMSyncedEntry.lastSyncedHash
         │
         ├─ Same Hash → Skip (no RM update needed)
         │
         └─ Different Hash → Update RM entry
                             Update RMSyncedEntry.lastSyncedHash
                             Update RMSyncedEntryComponent metadata
```

---

## 5. Edge Case Handling

### 5.1 Aggregation Edge Cases

| Edge Case | Scenario | Handling Strategy |
|-----------|----------|-------------------|
| **Single Entry Aggregate** | Only one TimesheetEntry for project-day | Aggregate still created (consistent structure) |
| **Zero Hours After Aggregation** | All entries marked as skipped/deleted | Skip sync, log warning |
| **Unmapped Project** | TimesheetEntry.projectId not in RMProjectMapping | Skip in aggregation, show in preview warning |
| **Null Project** | TimesheetEntry.projectId is null | Skip in aggregation, don't include in preview |
| **All Entries Skipped** | All entries have isSkipped=true | Don't include in aggregation |
| **Mixed Billable Status** | Some billable, some non-billable (should not occur) | ERROR - all entries for project must have same billable status |
| **Notes Overflow** | Notes field >500 characters | Truncate with "..." indicator, log full notes |
| **Date Range Overlap** | Entry spans midnight (shouldn't happen) | Should be prevented by existing multi-day splitting |

### 5.2 Sync Edge Cases

| Edge Case | Scenario | Handling Strategy |
|-----------|----------|-------------------|
| **Partial Aggregate Update** | 1 of 3 entries changed | Recalculate entire aggregate, update RM |
| **Component Deletion** | User deletes one TimesheetEntry | Recalculate aggregate, update RM hours down |
| **All Components Deleted** | User deletes all entries for project-day | Delete RM entry, delete RMSyncedEntry |
| **RM Entry Deleted Externally** | RM entry deleted in RM but exists locally | Detect on update (404), recreate entry |
| **Hash Collision** | Two different aggregates same hash (unlikely) | Add randomness to hash (e.g., include entry IDs) |
| **Concurrent Sync** | Two sync operations for same user | Prevented by existing RUNNING status check |
| **Transaction Failure** | Database error during component creation | Rollback entire sync transaction, mark FAILED |

### 5.3 Migration Edge Cases

| Edge Case | Scenario | Handling Strategy |
|-----------|----------|-------------------|
| **Orphaned RMSyncedEntry** | TimesheetEntry deleted before migration | Log warning, skip migration of this record |
| **Duplicate RM Entry IDs** | Multiple RMSyncedEntry → same rmEntryId | Error, require manual resolution |
| **Missing Project Mapping** | Mapping deleted but RMSyncedEntry exists | Mark as "stale", exclude from migration |
| **Hash Mismatch** | Migrated hash doesn't match recalculated | Accept discrepancy, will sync on next update |

---

## 6. Testing Strategy

### 6.1 Unit Testing

**Data Aggregation Functions:**
- ✅ Single entry aggregation (baseline)
- ✅ Multiple entries same project-day
- ✅ Different projects same day
- ✅ Different dates same project
- ✅ Billable logic: all billable, all non-billable, mixed
- ✅ Notes combination: null notes, duplicates, overflow
- ✅ Phase resolution: single, multiple same, multiple different, null

**Hash Calculation:**
- ✅ Deterministic hash (same input → same hash)
- ✅ Sensitive to changes (any field change → different hash)
- ✅ Order-independent (entry order doesn't affect hash)

### 6.2 Integration Testing

**Sync Workflow:**
- ✅ Preview shows aggregated entries
- ✅ Execute creates aggregated RM entries
- ✅ Update detection triggers on component change
- ✅ Retry logic works with aggregated data
- ✅ Error handling preserves transaction integrity

**Database Operations:**
- ✅ RMSyncedEntry creation with components
- ✅ Component tracking accurate
- ✅ Cascade deletes work correctly
- ✅ Indexes improve query performance

### 6.3 End-to-End Testing

**User Workflows:**
1. **Fresh Sync:** User syncs week with multiple entries → Verify aggregation in RM
2. **Update Sync:** User edits entry → Verify RM entry updated with new totals
3. **Delete Sync:** User deletes entry → Verify RM entry updated (hours reduced)
4. **Unmapped Project:** User has unmapped project → Verify warning shown, skipped
5. **Force Sync:** User force-syncs unchanged data → Verify all entries updated

### 6.4 Performance Testing

**Benchmarks:**
- 10 entries (1 week, 2 projects) → Aggregation < 50ms
- 50 entries (1 week, 10 projects) → Aggregation < 200ms
- 200 entries (1 month, 20 projects) → Aggregation < 1000ms

**Database Query Performance:**
- Fetch timesheet entries: < 100ms
- Group and aggregate: < 50ms
- Create RMSyncedEntry + components: < 200ms per aggregate

---

## 7. Data Contracts Between Subagents

### Contract 1: API Investigation → Business Logic
**Provider:** RM API Investigation Agent
**Consumer:** Business Logic Design Agent

**Data:**
```typescript
interface RMAPIFieldMapping {
  billableFieldSupported: boolean
  billableFieldName: string | null  // e.g., "billable", null if not supported
  phaseFieldSupported: boolean
  phaseFieldName: string | null     // e.g., "task", "phase", null if not supported
  notesFieldMaxLength: number       // e.g., 500
  alternativeEncoding: {
    encodeBillableInNotes: boolean  // Fallback strategy
    encodePhaseInTask: boolean      // Fallback strategy
  }
}
```

### Contract 2: Business Logic → Data Aggregation
**Provider:** Business Logic Design Agent
**Consumer:** Data Aggregation Agent

**Data:**
```typescript
interface AggregationRules {
  billableRule: 'ALL' | 'ANY' | 'MAJORITY'
  notesRule: 'CONCATENATE' | 'BULLET_LIST' | 'FIRST_ONLY'
  notesSeparator: string              // e.g., " | " or "\n• "
  notesMaxLength: number              // e.g., 500
  phaseRule: 'RECENT' | 'LONGEST' | 'CONCATENATE' | 'MULTIPLE'
  phaseResolutionStrategy: {
    // If phaseRule is LONGEST
    tiebreaker?: 'ALPHABETICAL' | 'RECENT'
  }
}
```

### Contract 3: Schema Migration → Data Aggregation
**Provider:** Schema Migration Agent
**Consumer:** Data Aggregation Agent

**Data:**
```typescript
// Updated Prisma types (auto-generated)
import { RMSyncedEntry, RMSyncedEntryComponent } from '@prisma/client'

// Plus helper types
type RMSyncedEntryWithComponents = RMSyncedEntry & {
  components: (RMSyncedEntryComponent & {
    timesheetEntry: TimesheetEntry
  })[]
}
```

### Contract 4: Data Aggregation → Sync Orchestration
**Provider:** Data Aggregation Agent
**Consumer:** Sync Orchestration Agent

**Data:**
```typescript
interface AggregatedEntry {
  // Grouping key
  projectId: string
  date: Date

  // Aggregated values
  totalMinutes: number
  totalHours: number       // Calculated: totalMinutes / 60
  isBillable: boolean
  phase: string | null
  notes: string | null

  // Metadata
  contributingEntryIds: string[]
  contributingEntries: TimesheetEntry[]

  // Sync tracking
  aggregateHash: string
  existingRMSyncedEntry?: RMSyncedEntry
}

// Function signature
function aggregateEntriesByProjectDay(
  entries: TimesheetEntry[],
  rules: AggregationRules
): Map<string, AggregatedEntry>
```

### Contract 5: Sync Orchestration → API Router
**Provider:** Sync Orchestration Agent
**Consumer:** API Router Agent

**Data:**
```typescript
// Updated sync preview result
interface SyncPreviewResult {
  totalEntries: number      // Total aggregates (not individual entries)
  toCreate: number
  toUpdate: number
  toSkip: number
  unmappedProjects: Array<{ projectId: string; projectName: string }>
  entries: Array<{
    timesheetEntryIds: string[]  // NEW: IDs of contributing entries
    projectName: string
    date: string
    hours: number               // Aggregated hours
    isBillable: boolean         // NEW
    phase: string | null        // NEW
    notes: string | null        // Combined notes
    action: 'create' | 'update' | 'skip'
    reason?: string
    componentCount: number      // NEW: Number of entries in aggregate
  }>
}
```

### Contract 6: API Router → Frontend UI
**Provider:** API Router Agent
**Consumer:** Frontend UI Agent

**Data:**
```typescript
// tRPC output type (auto-inferred)
type SyncPreviewOutput = RouterOutput['rm']['sync']['preview']

// Includes all fields from SyncPreviewResult above
```

---

## 8. Validation Checkpoints

### Checkpoint 1: Research Complete
**When:** After Phase 1 (API Investigation + Business Logic)
**Validate:**
- [ ] RM API field mapping documented
- [ ] Billable field strategy decided (native or notes encoding)
- [ ] Phase field strategy decided (task/phase or notes encoding)
- [ ] User decisions on billable/notes/phase rules recorded
- [ ] Test case specifications written

**Go/No-Go Decision:** Proceed to schema design only if API capabilities confirmed

---

### Checkpoint 2: Schema Ready
**When:** After Phase 2 (Schema Migration)
**Validate:**
- [ ] Prisma schema updated with new models
- [ ] Migration files created and tested locally
- [ ] Indexes added for aggregation queries
- [ ] Rollback migration created
- [ ] No breaking changes to existing endpoints (backward compatibility)

**Go/No-Go Decision:** Proceed to implementation only if migration runs cleanly

---

### Checkpoint 3: Backend Integration
**When:** After Phase 3 (Core Implementation)
**Validate:**
- [ ] Aggregation functions tested (unit tests pass)
- [ ] Sync orchestration handles aggregation
- [ ] API endpoints return aggregated data
- [ ] Error handling works correctly
- [ ] Integration tests pass

**Testing:**
```bash
# Run backend tests
pnpm --filter api test

# Test preview endpoint
curl -X POST http://localhost:3001/trpc/rm.sync.preview \
  -H "Content-Type: application/json" \
  -d '{"fromDate":"2024-12-10","toDate":"2024-12-16"}'

# Verify aggregation in response
```

**Go/No-Go Decision:** Proceed to frontend only if backend fully functional

---

### Checkpoint 4: E2E Testing
**When:** After Phase 4 (Frontend + Migration)
**Validate:**
- [ ] Frontend displays aggregated previews correctly
- [ ] Sync executes successfully with aggregation
- [ ] Data migration script tested on staging
- [ ] Migrated data displays correctly in UI
- [ ] Rollback procedure tested

**Testing:**
```bash
# Run migration on staging database
DATABASE_URL="<staging-url>" npx tsx scripts/migrate-rm-sync-entries.ts

# Verify migration
DATABASE_URL="<staging-url>" npx tsx scripts/verify-rm-migration.ts

# Test E2E flow
pnpm --filter web e2e
```

**Go/No-Go Decision:** Proceed to production only if E2E tests pass

---

### Checkpoint 5: Production Readiness
**When:** After Phase 5 (Testing + Documentation)
**Validate:**
- [ ] All test suites pass (unit + integration + E2E)
- [ ] Performance benchmarks meet targets
- [ ] Documentation updated and reviewed
- [ ] Migration plan documented
- [ ] Rollback plan documented
- [ ] Monitoring alerts configured

**Final Checks:**
- [ ] Code review completed
- [ ] Staging deployment successful
- [ ] User acceptance testing passed
- [ ] Production migration scheduled

---

## 9. Rollback Strategy

### Level 1: Rollback Sync Execution (No Code Changes)
**Scenario:** Aggregation produces incorrect results, but schema is fine
**Action:**
1. Disable RM sync feature flag (if implemented)
2. Fix aggregation logic bug
3. Re-deploy backend
4. Re-enable sync

**Downtime:** None (feature disabled, users can't sync until fixed)

---

### Level 2: Rollback Schema Migration
**Scenario:** Schema changes cause issues, need to revert
**Action:**
1. Disable RM sync in UI
2. Run rollback migration script:
   ```bash
   npx tsx scripts/rollback-rm-migration.ts
   ```
3. Revert Prisma schema to previous version
4. Regenerate Prisma client
5. Revert code to previous commit
6. Deploy

**Downtime:** ~30 minutes (database migration time)

**Data Loss:**
- Syncs performed after migration will be lost
- Need to re-sync after fix deployed

---

### Level 3: Complete Feature Rollback
**Scenario:** Major issues, need to completely remove feature
**Action:**
1. Revert all code changes (git revert)
2. Run schema rollback migration
3. Delete `RMSyncedEntryComponent` table
4. Restore `RMSyncedEntry` 1:1 relationship
5. Deploy

**Downtime:** ~1 hour
**Data Loss:** All sync history from new schema period

---

## 10. Success Criteria

### Functional Requirements
- [ ] ✅ Single RM time entry created per project per day
- [ ] ✅ Duration correctly aggregated (sum of all tasks)
- [ ] ✅ Billable status included in RM payload
- [ ] ✅ Phase/task information included in RM payload
- [ ] ✅ Notes consolidated from all entries
- [ ] ✅ Existing sync history migrated successfully
- [ ] ✅ Preview shows aggregated data accurately
- [ ] ✅ Update detection works when any component changes

### Performance Requirements
- [ ] ✅ Aggregation for 50 entries completes < 200ms
- [ ] ✅ Sync execution time not more than 20% slower than before
- [ ] ✅ Database queries use indexes efficiently
- [ ] ✅ No N+1 query problems

### Quality Requirements
- [ ] ✅ 80%+ unit test coverage for aggregation logic
- [ ] ✅ All integration tests pass
- [ ] ✅ E2E tests pass for sync workflow
- [ ] ✅ No regressions in existing functionality

### User Experience Requirements
- [ ] ✅ Preview clearly shows aggregation (e.g., "3 entries: 8h total")
- [ ] ✅ Billable status visible in UI
- [ ] ✅ Phase information visible in UI
- [ ] ✅ Error messages clear and actionable
- [ ] ✅ Sync time acceptable for weekly timesheet (~40 entries)

---

## 11. Risk Assessment

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| **RM API doesn't support billable field** | Medium | High | Encode in notes field or task field |
| **RM API doesn't support phase field** | Medium | Medium | Use task field or encode in notes |
| **Schema migration fails in production** | Low | Critical | Test extensively on staging, have rollback ready |
| **Aggregation logic produces incorrect totals** | Medium | High | Comprehensive unit tests, manual verification |
| **Performance degradation on large datasets** | Medium | Medium | Index optimization, query profiling |
| **Data loss during migration** | Low | Critical | Backup database before migration, verify script |
| **Users confused by aggregated view** | Medium | Low | Clear UI labels, documentation, tooltip explanations |
| **Hash collision causes sync issues** | Very Low | Medium | Include entry IDs in hash calculation |
| **Concurrent edits cause race conditions** | Low | Medium | Use database transactions, optimistic locking |

---

## 12. Timeline Estimate

**Total Duration:** 7-8 working days (1.5-2 weeks calendar time)

- Phase 1: Research & Planning (1-2 days) ← SIMPLIFIED (no business logic decisions needed)
- Phase 2: Schema & Migration (2 days) ← Includes phase removal
- Phase 3: Core Implementation (2-3 days) ← SIMPLIFIED (no billable/notes/phase logic)
- Phase 4: Frontend & Migration (1-2 days) ← SIMPLIFIED (no tooltips, simpler UI)
- Phase 5: Testing & Documentation (1 day) ← SIMPLIFIED (fewer test cases)

**Simplified due to:**
- ✅ No billable aggregation logic (project property)
- ✅ No notes combining logic (single field)
- ✅ No phase handling (being removed)
- ✅ No UI breakdown tooltips

**Critical Path:**
1. RM API Investigation (blocks business logic)
2. Business Logic Design (blocks all implementation)
3. Schema Migration (blocks data aggregation)
4. Data Aggregation (blocks sync orchestration)
5. Sync Orchestration (blocks API router)
6. API Router (blocks frontend)

**Parallel Work Opportunities:**
- Frontend UI can be developed in parallel with data migration scripts
- Testing can start as soon as unit tests are possible
- Documentation can be written throughout

---

## 13. Open Questions

**Technical:**
1. ❓ Does RM API support native `billable` field or custom fields? (CRITICAL - blocks implementation)
2. ❓ What is the max length for `notes` field in RM API?
3. ❓ Does RM API support batch operations (create multiple entries in one call)?
4. ❓ How should we handle time zone differences in aggregation (if date boundaries differ)?

**Business:**
5. ✅ ~~Should billable status use ALL, ANY, or MAJORITY rule?~~ → RESOLVED: No aggregation needed (project property)
6. ✅ ~~Should notes be concatenated with separator or bullet list?~~ → RESOLVED: Single note field per aggregate
7. ✅ ~~Should phase use most recent or longest duration?~~ → RESOLVED: Phase being removed
8. ❓ What happens to manually created RM entries (not synced from time-tracker)?

**Product:**
9. ✅ ~~Should we show a breakdown tooltip in UI?~~ → RESOLVED: No, user doesn't want this
10. ❓ Should force sync affect aggregation logic or just hash comparison?
11. ❓ Should we allow users to see component breakdown in a detail view?

---

## 14. Next Steps

**Immediate Actions:**
1. **Launch RM API Investigation Agent** to research field support
2. **Prepare user questions** for business logic decisions
3. **Create GitHub issue** with this plan for tracking
4. **Schedule kickoff meeting** to review plan with stakeholders

**Decision Required:**
- User must approve business logic rules before implementation begins
- User must confirm RM API investigation findings before schema design

**Blocker Resolution:**
- If RM API doesn't support billable/phase natively, decide on encoding strategy
- If performance testing reveals issues, may need to implement materialized aggregates

---

## Appendix A: Example RM API Payloads

### Current (Individual Entry)
```json
POST /api/v1/users/12345/time_entries
{
  "assignable_id": 67890,
  "date": "2024-12-10",
  "hours": 0.5,
  "notes": "Team standup meeting"
}
```

### Proposed (Aggregated Entry)
```json
POST /api/v1/users/12345/time_entries
{
  "assignable_id": 67890,
  "date": "2024-12-10",
  "hours": 8.0,
  "notes": "• Team standup meeting\n• Design review\n• Implementation work",
  "billable": true,
  "task": "Development"
}
```

**Note:** Field names `billable` and `task` are hypothetical pending API investigation.

---

## Appendix B: Sample Aggregation Output

**Input: 3 TimesheetEntry Records**
```typescript
[
  {
    id: "entry1",
    projectId: "proj1",
    date: "2024-12-10",
    duration: 30,      // minutes
    isBillable: true,
    phase: "Design",
    notes: "Team standup"
  },
  {
    id: "entry2",
    projectId: "proj1",
    date: "2024-12-10",
    duration: 90,
    isBillable: true,
    phase: "Development",
    notes: "Implementation work"
  },
  {
    id: "entry3",
    projectId: "proj1",
    date: "2024-12-10",
    duration: 360,
    isBillable: false,
    phase: "Development",
    notes: null
  }
]
```

**Output: 1 AggregatedEntry**
```typescript
{
  projectId: "proj1",
  date: "2024-12-10",
  totalMinutes: 480,           // 30 + 90 + 360
  totalHours: 8.0,             // 480 / 60
  isBillable: true,            // ANY billable rule
  phase: "Development",        // Longest duration (360 min)
  notes: "• Team standup\n• Implementation work",
  contributingEntryIds: ["entry1", "entry2", "entry3"],
  aggregateHash: "abc123..."   // SHA-256 of aggregated data
}
```

---

**END OF REFACTORING PLAN**
