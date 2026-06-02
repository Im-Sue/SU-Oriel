CREATE TABLE IF NOT EXISTS "EventConsumption" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "transitionId" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'dry_run',
  "result" TEXT NOT NULL,
  "requestSource" TEXT NOT NULL DEFAULT 'api_direct',
  "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proposalReason" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "EventConsumption_eventId_transitionId_mode_requestedAt_idx"
ON "EventConsumption"("eventId", "transitionId", "mode", "requestedAt");

CREATE INDEX IF NOT EXISTS "EventConsumption_taskId_requestedAt_idx"
ON "EventConsumption"("taskId", "requestedAt");

CREATE INDEX IF NOT EXISTS "EventConsumption_result_requestedAt_idx"
ON "EventConsumption"("result", "requestedAt");

-- rollback:
-- DROP INDEX IF EXISTS "EventConsumption_result_requestedAt_idx";
-- DROP INDEX IF EXISTS "EventConsumption_taskId_requestedAt_idx";
-- DROP INDEX IF EXISTS "EventConsumption_eventId_transitionId_mode_requestedAt_idx";
-- DROP TABLE IF EXISTS "EventConsumption";
