-- CreateTable
CREATE TABLE "task_slot_allocation" (
    "slot_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cc_agent" TEXT NOT NULL,
    "cx_agent" TEXT NOT NULL,
    "bound_task_id" TEXT,
    "provider_pair" TEXT NOT NULL,
    "permission_profile" TEXT NOT NULL,
    "ccb_submission_id" TEXT,
    "ccb_job_id" TEXT,
    "trace_ref" TEXT,
    "state" TEXT NOT NULL,
    "dirty_state" TEXT,
    "lease_at" DATETIME,
    "heartbeat_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "task_slot_allocation_bound_task_id_fkey" FOREIGN KEY ("bound_task_id") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "task_slot_allocation_state_idx" ON "task_slot_allocation"("state");

-- CreateIndex
CREATE INDEX "task_slot_allocation_bound_task_id_idx" ON "task_slot_allocation"("bound_task_id");

-- v0.5 uses inplace workspaces, so only one task slot may write the repo at a time.
CREATE UNIQUE INDEX "task_slot_allocation_single_busy_idx" ON "task_slot_allocation"("state") WHERE "state" = 'busy';
