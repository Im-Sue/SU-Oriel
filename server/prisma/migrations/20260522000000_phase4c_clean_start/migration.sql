-- Phase 4c clean start: remove deprecated Console-owned runtime storage.
-- This migration is intentionally destructive; v1.0 treats docs/.ccb as the canonical source.

PRAGMA foreign_keys=OFF;

-- Clean start: clear Console projection/internal/audit rows before schema contraction.
DELETE FROM "user_intent";
DELETE FROM "RoleProfile";
DELETE FROM "ExecutorProfile";
DELETE FROM "CapabilityStatus";
DELETE FROM "NodeRun";
DELETE FROM "PrimitiveAudit";
DELETE FROM "HookAuditLog";
DELETE FROM "EventJournal";
DELETE FROM "ReviewIntent";
DELETE FROM "TaskWorkspace";
DELETE FROM "SyncJob";
DELETE FROM "AiCliSetting";
DELETE FROM "RequirementEditAudit";
DELETE FROM "Requirement";
DELETE FROM "TaskRun";
DELETE FROM "task_checkpoints";
DELETE FROM "consult_requests";
DELETE FROM "anchor_allocation";
DELETE FROM "Sprint";
DELETE FROM "Task";
DELETE FROM "Document";

-- Retired modules/tables.
DROP TABLE IF EXISTS "projection_outbox";
DROP TABLE IF EXISTS "EventConsumption";
DROP TABLE IF EXISTS "SchedulerBranchState";
DROP TABLE IF EXISTS "SchedulerConsumerCursor";
DROP TABLE IF EXISTS "SchedulerLock";

-- Deprecated Task fields.
ALTER TABLE "Task" DROP COLUMN "stateHashProjection";
ALTER TABLE "Task" DROP COLUMN "stateRevisionSeen";
ALTER TABLE "Task" DROP COLUMN "step";
ALTER TABLE "Task" DROP COLUMN "legacyKind";
ALTER TABLE "Task" DROP COLUMN "legacyParentHint";
ALTER TABLE "Task" DROP COLUMN "migrationBatchId";
ALTER TABLE "Task" DROP COLUMN "migrationRuleId";
ALTER TABLE "Task" DROP COLUMN "migrationConfidence";
ALTER TABLE "Task" DROP COLUMN "migrationReviewedBy";
ALTER TABLE "Task" DROP COLUMN "migrationReviewedAt";

-- Deprecated Requirement fields.
ALTER TABLE "Requirement" DROP COLUMN "generatedTaskId";
ALTER TABLE "Requirement" DROP COLUMN "planRevision";

PRAGMA foreign_keys=ON;
