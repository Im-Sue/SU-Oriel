ALTER TABLE "Task" ADD COLUMN "reviewStatus" TEXT;
ALTER TABLE "Task" ADD COLUMN "verificationResultJson" TEXT;
ALTER TABLE "Task" ADD COLUMN "reviewFollowupJson" TEXT;

CREATE TABLE IF NOT EXISTS "ReviewIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "taskKey" TEXT NOT NULL,
  "intentType" TEXT NOT NULL,
  "payloadJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "actor" TEXT,
  "consumedAt" DATETIME,
  "consumedBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ReviewIntent_taskId_status_idx" ON "ReviewIntent"("taskId", "status");
CREATE INDEX IF NOT EXISTS "ReviewIntent_intentType_idx" ON "ReviewIntent"("intentType");
