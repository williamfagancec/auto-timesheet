# Migration: AI Suggestion Engine Schema

**Created:** 2025-01-09
**Name:** `20250109_ai_suggestion_engine`

## Changes

### 1. CategoryRule Table Enhancements

**Renamed Column:**
- `confidence` → `confidenceScore` (more descriptive name)

**New Columns:**
- `totalSuggestions` (INTEGER, default 0) - Track how many times rule was suggested
- `lastMatchedAt` (TIMESTAMP, nullable) - When rule was last matched/suggested

**New Indexes:**
- `CategoryRule_userId_condition_idx` - Optimize lookups by condition
- `CategoryRule_userId_projectId_idx` - Optimize project-specific queries

### 2. SuggestionLog Table (NEW)

**Purpose:** Track AI suggestion outcomes for analytics and learning

**Columns:**
- `id` (TEXT, PK) - CUID primary key
- `userId` (TEXT, FK → User) - User who received suggestion
- `eventId` (TEXT, FK → CalendarEvent) - Event that was suggested for
- `suggestedProjectId` (TEXT, FK → Project) - Project that was suggested
- `confidence` (DOUBLE PRECISION) - Confidence score of suggestion (0.0-1.0)
- `outcome` (TEXT) - Outcome: ACCEPTED, REJECTED, or IGNORED
- `createdAt` (TIMESTAMP) - When suggestion was made

**Indexes:**
- `SuggestionLog_userId_outcome_idx` - Analytics queries by outcome
- `SuggestionLog_userId_createdAt_idx` - Time-series analytics
- `SuggestionLog_eventId_idx` - Event-specific lookups

**Foreign Keys:**
- All foreign keys have `ON DELETE CASCADE` for data integrity

## Applying the Migration

### Option 1: Using Prisma Migrate (Recommended)

```bash
cd packages/database
npx prisma migrate deploy
```

This will apply all pending migrations in production/staging.

For development:
```bash
npx prisma migrate dev
```

### Option 2: Manual SQL Execution

If you need to apply manually:

```bash
psql $DATABASE_URL < prisma/migrations/20250109_ai_suggestion_engine/migration.sql
```

## Seeding Test Data

After migration, seed the database with sample rules:

```bash
cd packages/database
npx prisma db seed
```

This creates:
- 1 test user
- 4 sample projects
- 9 category rules with varying confidence levels
- 2 sample calendar events
- 2 suggestion logs

See `prisma/seed.ts` for details.

## Rollback

To rollback this migration, execute:

```sql
-- Drop SuggestionLog table
DROP TABLE IF EXISTS "SuggestionLog";

-- Remove new indexes from CategoryRule
DROP INDEX IF EXISTS "CategoryRule_userId_condition_idx";
DROP INDEX IF EXISTS "CategoryRule_userId_projectId_idx";

-- Remove new columns from CategoryRule
ALTER TABLE "CategoryRule" DROP COLUMN IF EXISTS "lastMatchedAt";
ALTER TABLE "CategoryRule" DROP COLUMN IF EXISTS "totalSuggestions";

-- Rename column back
ALTER TABLE "CategoryRule" RENAME COLUMN "confidenceScore" TO "confidence";
```

## Related Documentation

- See `docs/AI_ENGINE.md` for complete AI architecture
- See `docs/API.md` for API endpoint details
- See `docs/TESTING.md` for testing strategy
