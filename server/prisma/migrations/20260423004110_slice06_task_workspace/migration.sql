CREATE TABLE IF NOT EXISTS "TaskWorkspace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "lockedByRunId" TEXT,
  "taskKey" TEXT NOT NULL,
  "baseRef" TEXT NOT NULL DEFAULT 'HEAD',
  "branchName" TEXT NOT NULL,
  "workspacePath" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'creating',
  "lockMode" TEXT NOT NULL DEFAULT 'exclusive',
  "cleanupPolicy" TEXT NOT NULL DEFAULT 'manual',
  "cleanupAfter" DATETIME,
  "lastVerifiedAt" DATETIME,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TaskWorkspace_taskId_status_idx" ON "TaskWorkspace"("taskId", "status");
CREATE INDEX IF NOT EXISTS "TaskWorkspace_branchName_idx" ON "TaskWorkspace"("branchName");
CREATE INDEX IF NOT EXISTS "TaskWorkspace_lockedByRunId_idx" ON "TaskWorkspace"("lockedByRunId");
