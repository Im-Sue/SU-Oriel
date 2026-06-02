PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS "SchedulerConsumerCursor" (
  "taskId" TEXT NOT NULL PRIMARY KEY,
  "lastConsumedEventId" TEXT,
  "lastConsumedEmittedAt" DATETIME,
  "policyProfileAtConsume" TEXT,
  "entryAlias" TEXT,
  "pauseReason" TEXT,
  "pauseDetailJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "SchedulerConsumerCursor_lastConsumedEmittedAt_lastConsumedEventId_idx"
ON "SchedulerConsumerCursor"("lastConsumedEmittedAt", "lastConsumedEventId");

CREATE INDEX IF NOT EXISTS "SchedulerConsumerCursor_pauseReason_idx"
ON "SchedulerConsumerCursor"("pauseReason");

CREATE TABLE IF NOT EXISTS "SchedulerLock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "holderId" TEXT NOT NULL,
  "acquiredAt" DATETIME NOT NULL,
  "heartbeatAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "SchedulerLock_heartbeatAt_idx"
ON "SchedulerLock"("heartbeatAt");

-- rollback:
-- DROP INDEX IF EXISTS "SchedulerLock_heartbeatAt_idx";
-- DROP TABLE IF EXISTS "SchedulerLock";
-- DROP INDEX IF EXISTS "SchedulerConsumerCursor_pauseReason_idx";
-- DROP INDEX IF EXISTS "SchedulerConsumerCursor_lastConsumedEmittedAt_lastConsumedEventId_idx";
-- DROP TABLE IF EXISTS "SchedulerConsumerCursor";
