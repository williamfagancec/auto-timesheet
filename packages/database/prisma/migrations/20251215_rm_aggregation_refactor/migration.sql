-- RM Aggregation Refactor Migration
-- Changes RMSyncedEntry from 1:1 to 1:many relationship with TimesheetEntry
-- Adds RMSyncedEntryComponent junction table
-- Removes phase field from TimesheetEntry and UserProjectDefaults

-- Step 1: Create RMSyncedEntryComponent junction table
CREATE TABLE "RMSyncedEntryComponent" (
    "id" TEXT NOT NULL,
    "rmSyncedEntryId" TEXT NOT NULL,
    "timesheetEntryId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "isBillable" BOOLEAN NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RMSyncedEntryComponent_pkey" PRIMARY KEY ("id")
);

-- Step 2: Add aggregationDate to RMSyncedEntry (nullable initially)
ALTER TABLE "RMSyncedEntry" ADD COLUMN "aggregationDate" TIMESTAMP(3);

-- Step 3: Populate aggregationDate from linked TimesheetEntry dates
UPDATE "RMSyncedEntry" rse
SET "aggregationDate" = te."date"
FROM "TimesheetEntry" te
WHERE rse."timesheetEntryId" = te."id";

-- Step 4: Create RMSyncedEntryComponent records for existing RMSyncedEntry-TimesheetEntry pairs
INSERT INTO "RMSyncedEntryComponent" ("id", "rmSyncedEntryId", "timesheetEntryId", "durationMinutes", "isBillable", "notes", "createdAt")
SELECT
    gen_random_uuid()::text,
    rse."id",
    te."id",
    te."duration",
    te."isBillable",
    te."notes",
    CURRENT_TIMESTAMP
FROM "RMSyncedEntry" rse
INNER JOIN "TimesheetEntry" te ON rse."timesheetEntryId" = te."id";

-- Step 5: Drop old timesheetEntryId unique constraint and column
ALTER TABLE "RMSyncedEntry" DROP CONSTRAINT IF EXISTS "RMSyncedEntry_timesheetEntryId_key";
DROP INDEX IF EXISTS "RMSyncedEntry_timesheetEntryId_idx";
ALTER TABLE "RMSyncedEntry" DROP COLUMN IF EXISTS "timesheetEntryId";

-- Step 6: Make aggregationDate NOT NULL and add unique constraint
ALTER TABLE "RMSyncedEntry" ALTER COLUMN "aggregationDate" SET NOT NULL;
CREATE UNIQUE INDEX "RMSyncedEntry_mappingId_aggregationDate_key" ON "RMSyncedEntry"("mappingId", "aggregationDate");
CREATE INDEX "RMSyncedEntry_aggregationDate_idx" ON "RMSyncedEntry"("aggregationDate");

-- Step 7: Create indexes for RMSyncedEntryComponent
CREATE UNIQUE INDEX "RMSyncedEntryComponent_rmSyncedEntryId_timesheetEntryId_key" ON "RMSyncedEntryComponent"("rmSyncedEntryId", "timesheetEntryId");
CREATE INDEX "RMSyncedEntryComponent_rmSyncedEntryId_idx" ON "RMSyncedEntryComponent"("rmSyncedEntryId");
CREATE INDEX "RMSyncedEntryComponent_timesheetEntryId_idx" ON "RMSyncedEntryComponent"("timesheetEntryId");

-- Step 8: Add foreign keys for RMSyncedEntryComponent
ALTER TABLE "RMSyncedEntryComponent" ADD CONSTRAINT "RMSyncedEntryComponent_rmSyncedEntryId_fkey" FOREIGN KEY ("rmSyncedEntryId") REFERENCES "RMSyncedEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RMSyncedEntryComponent" ADD CONSTRAINT "RMSyncedEntryComponent_timesheetEntryId_fkey" FOREIGN KEY ("timesheetEntryId") REFERENCES "TimesheetEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 9: Remove phase field from TimesheetEntry
ALTER TABLE "TimesheetEntry" DROP COLUMN IF EXISTS "phase";

-- Step 10: Remove phase field from UserProjectDefaults
ALTER TABLE "UserProjectDefaults" DROP COLUMN IF EXISTS "phase";

-- Step 11: Update hash comment in RMSyncedEntry (metadata only, no structural change)
COMMENT ON COLUMN "RMSyncedEntry"."lastSyncedHash" IS 'Hash of aggregated data (date + totalHours + isBillable + notes)';
