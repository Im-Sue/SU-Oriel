-- TA1 · task-anchor-bootstrap: replace task slot pool with epic-level anchor allocation.
DROP TABLE IF EXISTS "task_slot_allocation";

CREATE TABLE "anchor_allocation" (
    "anchor_id" TEXT NOT NULL PRIMARY KEY,
    "anchor_path" TEXT NOT NULL,
    "project_id" TEXT,
    "socket_path" TEXT,
    "bound_epic_task_id" TEXT,
    "current_subtask_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'planned',
    "dirty_state" TEXT,
    "started_at" DATETIME,
    "heartbeat_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "anchor_allocation_anchor_path_key" ON "anchor_allocation"("anchor_path");
CREATE INDEX "anchor_allocation_state_idx" ON "anchor_allocation"("state");
CREATE INDEX "anchor_allocation_bound_epic_task_id_idx" ON "anchor_allocation"("bound_epic_task_id");
