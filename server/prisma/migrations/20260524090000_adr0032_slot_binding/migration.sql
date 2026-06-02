CREATE TABLE "slot_binding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "requirement_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'idle',
    "bound_at" DATETIME,
    "released_at" DATETIME,
    "busy_since" DATETIME,
    "last_activity_at" DATETIME,
    "stale_detected_at" DATETIME,
    "stale_notified_count" INTEGER NOT NULL DEFAULT 0,
    "history_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "slot_binding_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "slot_binding_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "Requirement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "slot_binding_project_id_slot_id_key" ON "slot_binding"("project_id", "slot_id");
CREATE INDEX "slot_binding_project_id_state_idx" ON "slot_binding"("project_id", "state");
CREATE INDEX "slot_binding_requirement_id_idx" ON "slot_binding"("requirement_id");
