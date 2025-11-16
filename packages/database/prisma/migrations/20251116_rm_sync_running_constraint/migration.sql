-- CreateIndex
-- Partial unique index to ensure only one RUNNING sync per connection at a time
-- This prevents race conditions where two requests both see no RUNNING row and create one
CREATE UNIQUE INDEX "RMSyncLog_connection_running_unique" ON "RMSyncLog"("connectionId") WHERE status = 'RUNNING';
