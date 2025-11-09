-- AlterTable: CategoryRule - Add new fields for AI engine
ALTER TABLE "CategoryRule" RENAME COLUMN "confidence" TO "confidenceScore";
ALTER TABLE "CategoryRule" ADD COLUMN "totalSuggestions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CategoryRule" ADD COLUMN "lastMatchedAt" TIMESTAMP(3);

-- CreateIndex: Additional indexes on CategoryRule for performance
CREATE INDEX "CategoryRule_userId_condition_idx" ON "CategoryRule"("userId", "condition");
CREATE INDEX "CategoryRule_userId_projectId_idx" ON "CategoryRule"("userId", "projectId");

-- CreateTable: SuggestionLog for analytics tracking
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

-- CreateIndex: Indexes on SuggestionLog for analytics queries
CREATE INDEX "SuggestionLog_userId_outcome_idx" ON "SuggestionLog"("userId", "outcome");
CREATE INDEX "SuggestionLog_userId_createdAt_idx" ON "SuggestionLog"("userId", "createdAt");
CREATE INDEX "SuggestionLog_eventId_idx" ON "SuggestionLog"("eventId");

-- AddForeignKey: SuggestionLog relations
ALTER TABLE "SuggestionLog" ADD CONSTRAINT "SuggestionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuggestionLog" ADD CONSTRAINT "SuggestionLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuggestionLog" ADD CONSTRAINT "SuggestionLog_suggestedProjectId_fkey" FOREIGN KEY ("suggestedProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
