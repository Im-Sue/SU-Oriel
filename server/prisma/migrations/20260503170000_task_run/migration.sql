CREATE TABLE IF NOT EXISTS "TaskRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_n" INTEGER NOT NULL DEFAULT 1,
  "dispatched_at" DATETIME,
  "completed_at" DATETIME,
  "error_summary" TEXT,
  "transitions" TEXT NOT NULL DEFAULT '[]',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "TaskRun_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TaskRun_taskId_status_idx"
ON "TaskRun"("taskId", "status");

CREATE INDEX IF NOT EXISTS "TaskRun_taskId_attempt_n_idx"
ON "TaskRun"("taskId", "attempt_n");

CREATE INDEX IF NOT EXISTS "TaskRun_status_idx"
ON "TaskRun"("status");
