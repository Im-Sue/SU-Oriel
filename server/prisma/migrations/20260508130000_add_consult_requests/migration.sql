CREATE TABLE "consult_requests" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "task_id" TEXT NOT NULL,
  "task_key" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "target_agent" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "consult_round" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumed_at" DATETIME,
  CONSTRAINT "consult_requests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "consult_requests_task_id_status_idx" ON "consult_requests"("task_id", "status");

CREATE UNIQUE INDEX "consult_requests_task_pending" ON "consult_requests"("task_id") WHERE "status" = 'pending';
