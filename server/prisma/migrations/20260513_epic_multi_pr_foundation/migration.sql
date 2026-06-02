-- PR0 · Epic Multi-PR Foundation
-- Requirement split mode is a product decision axis, separate from outputMode.
ALTER TABLE "Requirement" ADD COLUMN "split_mode" TEXT NOT NULL DEFAULT 'direct_pr';

-- Task materialization state is used by Epic split planning carriers.
ALTER TABLE "Task" ADD COLUMN "materialization_state" TEXT;

CREATE INDEX "Requirement_split_mode_idx" ON "Requirement"("split_mode");

CREATE INDEX "Task_materialization_state_idx"
ON "Task"("materialization_state")
WHERE "materialization_state" IS NOT NULL;
