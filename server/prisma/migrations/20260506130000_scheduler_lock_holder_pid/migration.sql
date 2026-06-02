ALTER TABLE "SchedulerLock" ADD COLUMN "holderPid" INTEGER;

-- rollback:
-- SQLite does not support dropping columns without table rebuild.
