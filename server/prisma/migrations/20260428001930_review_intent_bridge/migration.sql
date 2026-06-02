ALTER TABLE "ReviewIntent" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReviewIntent" ADD COLUMN "lastError" TEXT;
ALTER TABLE "ReviewIntent" ADD COLUMN "lastAttemptAt" DATETIME;

-- rollback:
-- ALTER TABLE "ReviewIntent" DROP COLUMN "lastAttemptAt";
-- ALTER TABLE "ReviewIntent" DROP COLUMN "lastError";
-- ALTER TABLE "ReviewIntent" DROP COLUMN "attemptCount";
