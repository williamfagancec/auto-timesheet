-- Migration: Lucia Auth → Better-Auth
-- This migration updates the database schema to support Better-Auth

-- ============================================================================
-- STEP 1: Add new fields to User table
-- ============================================================================
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "image" TEXT;
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ============================================================================
-- STEP 2: Update Session table with Better-Auth required fields
-- ============================================================================
-- Add new columns
ALTER TABLE "Session" ADD COLUMN "token" TEXT;
ALTER TABLE "Session" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "Session" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "Session" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Generate unique tokens for existing sessions using a combination of id and random string
-- This ensures existing sessions get valid tokens before we add the constraint
UPDATE "Session"
SET "token" = CONCAT('legacy_', "id", '_', substring(md5(random()::text), 1, 16))
WHERE "token" IS NULL;

-- Add NOT NULL and UNIQUE constraints after populating existing rows
ALTER TABLE "Session" ALTER COLUMN "token" SET NOT NULL;
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- ============================================================================
-- STEP 3: Create Account table for OAuth tokens
-- ============================================================================
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Add indexes for Account table
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- ============================================================================
-- STEP 4: Create Verification table for email verification
-- ============================================================================
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add unique index for Verification table
CREATE UNIQUE INDEX "Verification_identifier_value_key" ON "Verification"("identifier", "value");

-- ============================================================================
-- STEP 5: Migrate OAuth data from CalendarConnection to Account table
-- ============================================================================
-- Note: This migration does NOT migrate the actual OAuth tokens because:
-- 1. Better-Auth uses a different encryption method than the custom AES-256-GCM
-- 2. Users will need to re-authenticate with Google OAuth after migration
-- 3. This is acceptable per user confirmation ("Force re-authentication")
--
-- We only create CalendarConnection records without tokens.
-- The Account table will be populated when users re-authenticate via Better-Auth.

-- ============================================================================
-- STEP 6: Update CalendarConnection table
-- ============================================================================
-- Remove OAuth token fields (tokens now stored in Account table)
ALTER TABLE "CalendarConnection" DROP COLUMN IF EXISTS "accessToken";
ALTER TABLE "CalendarConnection" DROP COLUMN IF EXISTS "refreshToken";
ALTER TABLE "CalendarConnection" DROP COLUMN IF EXISTS "expiresAt";

-- Remove diagnostic/monitoring fields (per user decision: "Remove monitoring, rely on Better-Auth")
ALTER TABLE "CalendarConnection" DROP COLUMN IF EXISTS "refreshTokenUpdatedAt";
ALTER TABLE "CalendarConnection" DROP COLUMN IF EXISTS "lastRefreshAttempt";
ALTER TABLE "CalendarConnection" DROP COLUMN IF EXISTS "refreshFailureCount";
ALTER TABLE "CalendarConnection" DROP COLUMN IF EXISTS "lastRefreshError";

-- The remaining fields in CalendarConnection are:
-- id, userId, provider, selectedCalendarIds, timezone, lastSyncAt, lastSyncError, createdAt, updatedAt

-- ============================================================================
-- STEP 7: Drop OAuthState table
-- ============================================================================
-- Better-Auth handles OAuth state internally, no need for separate table
DROP TABLE IF EXISTS "OAuthState";

-- ============================================================================
-- STEP 8: Invalidate all existing sessions
-- ============================================================================
-- All users must re-login after this migration
-- This is necessary because:
-- 1. Session structure changed (new token field)
-- 2. Better-Auth uses different session management
-- 3. User confirmed this is acceptable
DELETE FROM "Session";

-- ============================================================================
-- IMPORTANT POST-MIGRATION NOTES
-- ============================================================================
-- 1. All users must re-login after deployment
-- 2. Users must re-authenticate with Google OAuth to reconnect calendar
-- 3. Email verification is now enabled - new signups require email verification
-- 4. Configure email service (Resend/SendGrid) for verification emails to work
-- 5. Set environment variables: BETTER_AUTH_SECRET, API_URL
