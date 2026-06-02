-- Historical migration repair (Phase 4c):
-- The original file was an accidental full-schema baseline that failed on fresh
-- replay after earlier migrations had already created the base tables. This is
-- the equivalent incremental diff from the pre-SP-B15 schema to that target.

-- DropIndex
DROP INDEX "RequirementMaterialization_taskId_key";

-- DropIndex
DROP INDEX "RequirementMaterialization_requirementId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RequirementMaterialization";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EventJournal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "subject_key" TEXT,
    "anchor_id" TEXT,
    "payloadJson" TEXT NOT NULL,
    "emittedAt" DATETIME NOT NULL,
    "sourceActor" TEXT,
    "sourceComponent" TEXT,
    "causationId" TEXT,
    "correlationId" TEXT,
    "stateRevisionSeen" INTEGER,
    "idempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EventJournal" ("anchor_id", "causationId", "correlationId", "createdAt", "emittedAt", "eventId", "eventType", "id", "idempotencyKey", "payloadJson", "projectId", "sourceActor", "sourceComponent", "stateRevisionSeen", "updatedAt") SELECT "anchor_id", "causationId", "correlationId", "createdAt", "emittedAt", "eventId", "eventType", "id", "idempotencyKey", "payloadJson", "projectId", "sourceActor", "sourceComponent", "stateRevisionSeen", "updatedAt" FROM "EventJournal";
DROP TABLE "EventJournal";
ALTER TABLE "new_EventJournal" RENAME TO "EventJournal";
CREATE INDEX "EventJournal_anchor_id_emittedAt_idx" ON "EventJournal"("anchor_id" ASC, "emittedAt" ASC);
CREATE INDEX "EventJournal_eventType_emittedAt_idx" ON "EventJournal"("eventType" ASC, "emittedAt" ASC);
CREATE INDEX "EventJournal_projectId_eventType_emittedAt_idx" ON "EventJournal"("projectId" ASC, "eventType" ASC, "emittedAt" ASC);
CREATE INDEX "EventJournal_subject_type_subject_id_eventType_emittedAt_idx" ON "EventJournal"("subject_type" ASC, "subject_id" ASC, "eventType" ASC, "emittedAt" ASC);
CREATE UNIQUE INDEX "EventJournal_eventId_key" ON "EventJournal"("eventId" ASC);
CREATE TABLE "new_Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "outputMode" TEXT NOT NULL DEFAULT 'spec_plan_task',
    "split_mode" TEXT NOT NULL DEFAULT 'direct_pr',
    "generatedTaskId" TEXT,
    "sourceTaskId" TEXT,
    "verbatimSource" TEXT,
    "claudeInterpretation" TEXT,
    "ambiguities" TEXT,
    "fidelityDiff" TEXT,
    "analysisInputHash" TEXT,
    "analysisStaleAt" DATETIME,
    "currentPlanningNode" TEXT,
    "currentPlanningStep" TEXT DEFAULT 'analysis',
    "planningSubstate" TEXT,
    "planningRuntimeState" TEXT DEFAULT 'idle',
    "lastPlanningTransitionId" TEXT,
    "planRevision" INTEGER NOT NULL DEFAULT 0,
    "planDocPath" TEXT,
    "breakdownDraftPath" TEXT,
    "planningAnchorId" TEXT,
    "rollupProgress" INTEGER NOT NULL DEFAULT 0,
    "rollupStatus" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Requirement" ("ambiguities", "analysisInputHash", "analysisStaleAt", "claudeInterpretation", "createdAt", "createdBy", "description", "fidelityDiff", "generatedTaskId", "id", "outputMode", "projectId", "source", "sourceTaskId", "split_mode", "status", "title", "updatedAt", "updatedBy", "verbatimSource") SELECT "ambiguities", "analysisInputHash", "analysisStaleAt", "claudeInterpretation", "createdAt", "createdBy", "description", "fidelityDiff", "generatedTaskId", "id", "outputMode", "projectId", "source", "sourceTaskId", "split_mode", "status", "title", "updatedAt", "updatedBy", "verbatimSource" FROM "Requirement";
DROP TABLE "Requirement";
ALTER TABLE "new_Requirement" RENAME TO "Requirement";
CREATE INDEX "Requirement_sourceTaskId_idx" ON "Requirement"("sourceTaskId" ASC);
CREATE INDEX "Requirement_split_mode_idx" ON "Requirement"("split_mode" ASC);
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentNode" TEXT,
    "nodeSubstate" TEXT,
    "runtimeState" TEXT DEFAULT 'running',
    "lastTransitionId" TEXT,
    "ownerUserId" TEXT,
    "assigneeUserId" TEXT,
    "reviewerUserId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "stateHashProjection" TEXT,
    "stateRevisionSeen" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "step" INTEGER,
    "primaryDocumentId" TEXT,
    "linkedSpecId" TEXT,
    "linkedPlanId" TEXT,
    "linkedTaskDocId" TEXT,
    "blockedReason" TEXT,
    "requirementId" TEXT,
    "reviewStatus" TEXT,
    "verificationResultJson" TEXT,
    "reviewFollowupJson" TEXT,
    "specSectionId" TEXT,
    "implementationOwner" TEXT,
    "sprintId" TEXT,
    "storyPoints" INTEGER,
    "legacyKind" TEXT,
    "legacyParentHint" TEXT,
    "migrationBatchId" TEXT,
    "migrationRuleId" TEXT,
    "migrationConfidence" REAL,
    "migrationReviewedBy" TEXT,
    "migrationReviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("sprintId") REFERENCES "Sprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeUserId", "blockedReason", "createdAt", "createdBy", "currentNode", "id", "implementationOwner", "lastTransitionId", "legacyKind", "legacyParentHint", "linkedPlanId", "linkedSpecId", "linkedTaskDocId", "migrationBatchId", "migrationConfidence", "migrationReviewedAt", "migrationReviewedBy", "migrationRuleId", "nodeSubstate", "ownerUserId", "primaryDocumentId", "priority", "progress", "projectId", "requirementId", "reviewFollowupJson", "reviewStatus", "reviewerUserId", "runtimeState", "specSectionId", "sprintId", "stateHashProjection", "stateRevisionSeen", "status", "step", "storyPoints", "summary", "taskKey", "title", "updatedAt", "updatedBy", "verificationResultJson") SELECT "assigneeUserId", "blockedReason", "createdAt", "createdBy", "currentNode", "id", "implementationOwner", "lastTransitionId", "legacyKind", "legacyParentHint", "linkedPlanId", "linkedSpecId", "linkedTaskDocId", "migrationBatchId", "migrationConfidence", "migrationReviewedAt", "migrationReviewedBy", "migrationRuleId", "nodeSubstate", "ownerUserId", "primaryDocumentId", "priority", "progress", "projectId", "requirementId", "reviewFollowupJson", "reviewStatus", "reviewerUserId", "runtimeState", "specSectionId", "sprintId", "stateHashProjection", "stateRevisionSeen", "status", "step", "storyPoints", "summary", "taskKey", "title", "updatedAt", "updatedBy", "verificationResultJson" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_projectId_taskKey_key" ON "Task"("projectId" ASC, "taskKey" ASC);
CREATE INDEX "Task_sprintId_idx" ON "Task"("sprintId" ASC);
CREATE INDEX "Task_currentNode_idx" ON "Task"("currentNode" ASC);
CREATE INDEX "Task_requirementId_currentNode_idx" ON "Task"("requirementId" ASC, "currentNode" ASC);
CREATE TABLE "new_anchor_allocation" (
    "anchor_id" TEXT NOT NULL PRIMARY KEY,
    "anchor_path" TEXT NOT NULL,
    "project_id" TEXT,
    "socket_path" TEXT,
    "runtime_paused" BOOLEAN NOT NULL DEFAULT false,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "subject_key" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'execution',
    "state" TEXT NOT NULL DEFAULT 'planned',
    "dirty_state" TEXT,
    "started_at" DATETIME,
    "heartbeat_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_anchor_allocation" ("anchor_id", "anchor_path", "created_at", "dirty_state", "heartbeat_at", "project_id", "runtime_paused", "socket_path", "started_at", "state", "updated_at") SELECT "anchor_id", "anchor_path", "created_at", "dirty_state", "heartbeat_at", "project_id", "runtime_paused", "socket_path", "started_at", "state", "updated_at" FROM "anchor_allocation";
DROP TABLE "anchor_allocation";
ALTER TABLE "new_anchor_allocation" RENAME TO "anchor_allocation";
CREATE INDEX "anchor_allocation_subject_type_subject_id_mode_idx" ON "anchor_allocation"("subject_type" ASC, "subject_id" ASC, "mode" ASC);
CREATE INDEX "anchor_allocation_state_idx" ON "anchor_allocation"("state" ASC);
CREATE UNIQUE INDEX "anchor_allocation_anchor_path_key" ON "anchor_allocation"("anchor_path" ASC);
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
