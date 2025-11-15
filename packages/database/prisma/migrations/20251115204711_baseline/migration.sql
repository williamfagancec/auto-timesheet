-- CreateEnum
CREATE TYPE "RMSyncStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "RMSyncDirection" AS ENUM ('PUSH', 'PULL', 'BIDIRECTIONAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "hashedPassword" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "selectedCalendarIds" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "refreshTokenUpdatedAt" TIMESTAMP(3),
    "lastRefreshAttempt" TIMESTAMP(3),
    "refreshFailureCount" INTEGER NOT NULL DEFAULT 0,
    "lastRefreshError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "attendees" JSONB,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "splitIndex" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "projectId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "phase" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "totalSuggestions" INTEGER NOT NULL DEFAULT 0,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastMatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "suggestedProjectId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RMConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "tokenIv" TEXT NOT NULL,
    "tokenAuthTag" TEXT NOT NULL,
    "rmUserId" INTEGER NOT NULL,
    "rmUserEmail" TEXT NOT NULL,
    "rmUserName" TEXT,
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RMConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RMProjectMapping" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rmProjectId" INTEGER NOT NULL,
    "rmProjectName" TEXT NOT NULL,
    "rmProjectCode" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RMProjectMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RMSyncedEntry" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "timesheetEntryId" TEXT NOT NULL,
    "rmEntryId" INTEGER NOT NULL,
    "rmEntryUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedHash" TEXT NOT NULL,
    "syncVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RMSyncedEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RMSyncLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "RMSyncStatus" NOT NULL,
    "direction" "RMSyncDirection" NOT NULL,
    "entriesAttempted" INTEGER NOT NULL DEFAULT 0,
    "entriesSuccess" INTEGER NOT NULL DEFAULT 0,
    "entriesFailed" INTEGER NOT NULL DEFAULT 0,
    "entriesSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RMSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProjectDefaults" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "phase" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProjectDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "CalendarConnection_userId_idx" ON "CalendarConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_provider_key" ON "CalendarConnection"("userId", "provider");

-- CreateIndex
CREATE INDEX "Project_userId_lastUsedAt_idx" ON "Project"("userId", "lastUsedAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_startTime_idx" ON "CalendarEvent"("userId", "startTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_isDeleted_idx" ON "CalendarEvent"("userId", "isDeleted");

-- CreateIndex
CREATE INDEX "CalendarEvent_date_range_idx" ON "CalendarEvent"("userId", "startTime", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_userId_googleEventId_splitIndex_key" ON "CalendarEvent"("userId", "googleEventId", "splitIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetEntry_eventId_key" ON "TimesheetEntry"("eventId");

-- CreateIndex
CREATE INDEX "TimesheetEntry_userId_date_idx" ON "TimesheetEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "CategoryRule_userId_ruleType_idx" ON "CategoryRule"("userId", "ruleType");

-- CreateIndex
CREATE INDEX "CategoryRule_userId_condition_idx" ON "CategoryRule"("userId", "condition");

-- CreateIndex
CREATE INDEX "CategoryRule_userId_projectId_idx" ON "CategoryRule"("userId", "projectId");

-- CreateIndex
CREATE INDEX "CategoryRule_performance_idx" ON "CategoryRule"("userId", "accuracy" DESC, "totalSuggestions" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRule_userId_ruleType_condition_projectId_key" ON "CategoryRule"("userId", "ruleType", "condition", "projectId");

-- CreateIndex
CREATE INDEX "SuggestionLog_userId_outcome_idx" ON "SuggestionLog"("userId", "outcome");

-- CreateIndex
CREATE INDEX "SuggestionLog_userId_createdAt_idx" ON "SuggestionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SuggestionLog_eventId_idx" ON "SuggestionLog"("eventId");

-- CreateIndex
CREATE INDEX "SuggestionLog_analytics_idx" ON "SuggestionLog"("userId", "createdAt", "outcome", "confidence");

-- CreateIndex
CREATE INDEX "SuggestionLog_project_idx" ON "SuggestionLog"("userId", "suggestedProjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RMConnection_userId_key" ON "RMConnection"("userId");

-- CreateIndex
CREATE INDEX "RMConnection_userId_idx" ON "RMConnection"("userId");

-- CreateIndex
CREATE INDEX "RMProjectMapping_connectionId_idx" ON "RMProjectMapping"("connectionId");

-- CreateIndex
CREATE INDEX "RMProjectMapping_projectId_idx" ON "RMProjectMapping"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "RMProjectMapping_connectionId_projectId_key" ON "RMProjectMapping"("connectionId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "RMProjectMapping_connectionId_rmProjectId_key" ON "RMProjectMapping"("connectionId", "rmProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "RMSyncedEntry_timesheetEntryId_key" ON "RMSyncedEntry"("timesheetEntryId");

-- CreateIndex
CREATE INDEX "RMSyncedEntry_mappingId_idx" ON "RMSyncedEntry"("mappingId");

-- CreateIndex
CREATE INDEX "RMSyncedEntry_timesheetEntryId_idx" ON "RMSyncedEntry"("timesheetEntryId");

-- CreateIndex
CREATE INDEX "RMSyncLog_connectionId_idx" ON "RMSyncLog"("connectionId");

-- CreateIndex
CREATE INDEX "RMSyncLog_status_idx" ON "RMSyncLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserProjectDefaults_userId_key" ON "UserProjectDefaults"("userId");

-- CreateIndex
CREATE INDEX "UserProjectDefaults_userId_idx" ON "UserProjectDefaults"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionLog" ADD CONSTRAINT "SuggestionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionLog" ADD CONSTRAINT "SuggestionLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionLog" ADD CONSTRAINT "SuggestionLog_suggestedProjectId_fkey" FOREIGN KEY ("suggestedProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RMConnection" ADD CONSTRAINT "RMConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RMProjectMapping" ADD CONSTRAINT "RMProjectMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "RMConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RMProjectMapping" ADD CONSTRAINT "RMProjectMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RMSyncedEntry" ADD CONSTRAINT "RMSyncedEntry_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "RMProjectMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RMSyncedEntry" ADD CONSTRAINT "RMSyncedEntry_timesheetEntryId_fkey" FOREIGN KEY ("timesheetEntryId") REFERENCES "TimesheetEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RMSyncLog" ADD CONSTRAINT "RMSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "RMConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectDefaults" ADD CONSTRAINT "UserProjectDefaults_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

