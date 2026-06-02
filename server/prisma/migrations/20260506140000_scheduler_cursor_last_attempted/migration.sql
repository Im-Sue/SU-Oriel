ALTER TABLE "SchedulerConsumerCursor" ADD COLUMN "lastAttemptedEventId" TEXT;
ALTER TABLE "SchedulerConsumerCursor" ADD COLUMN "lastAttemptedEmittedAt" DATETIME;

CREATE INDEX "SchedulerConsumerCursor_lastAttemptedEmittedAt_lastAttemptedEventId_idx"
  ON "SchedulerConsumerCursor"("lastAttemptedEmittedAt", "lastAttemptedEventId");

-- rollback:
-- SQLite does not support dropping columns without table rebuild.
