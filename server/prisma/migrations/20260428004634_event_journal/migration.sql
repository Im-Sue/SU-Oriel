CREATE TABLE IF NOT EXISTS "EventJournal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "taskKey" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "emittedAt" DATETIME NOT NULL,
  "sourceActor" TEXT,
  "sourceComponent" TEXT,
  "causationId" TEXT,
  "correlationId" TEXT,
  "stateRevisionSeen" INTEGER,
  "idempotencyKey" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventJournal_eventId_key" ON "EventJournal"("eventId");
CREATE INDEX IF NOT EXISTS "EventJournal_taskId_eventType_emittedAt_idx" ON "EventJournal"("taskId", "eventType", "emittedAt");
CREATE INDEX IF NOT EXISTS "EventJournal_projectId_eventType_emittedAt_idx" ON "EventJournal"("projectId", "eventType", "emittedAt");
CREATE INDEX IF NOT EXISTS "EventJournal_eventType_emittedAt_idx" ON "EventJournal"("eventType", "emittedAt");

-- rollback:
-- DROP INDEX IF EXISTS "EventJournal_eventType_emittedAt_idx";
-- DROP INDEX IF EXISTS "EventJournal_projectId_eventType_emittedAt_idx";
-- DROP INDEX IF EXISTS "EventJournal_taskId_eventType_emittedAt_idx";
-- DROP INDEX IF EXISTS "EventJournal_eventId_key";
-- DROP TABLE IF EXISTS "EventJournal";
