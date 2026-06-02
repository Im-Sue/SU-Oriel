-- CreateTable
CREATE TABLE "projection_outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiCliSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "projectId" TEXT,
    "toolId" TEXT NOT NULL,
    "command" TEXT,
    "extraArgs" TEXT,
    "defaultMode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiCliSetting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AiCliSetting" ("command", "createdAt", "defaultMode", "extraArgs", "id", "projectId", "scope", "toolId", "updatedAt") SELECT "command", "createdAt", "defaultMode", "extraArgs", "id", "projectId", "scope", "toolId", "updatedAt" FROM "AiCliSetting";
DROP TABLE "AiCliSetting";
ALTER TABLE "new_AiCliSetting" RENAME TO "AiCliSetting";
CREATE UNIQUE INDEX "AiCliSetting_scope_projectId_toolId_key" ON "AiCliSetting"("scope", "projectId", "toolId");
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskKey" TEXT,
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT,
    "frontmatterJson" TEXT,
    "summary" TEXT,
    "contentHash" TEXT NOT NULL,
    "mtime" DATETIME NOT NULL,
    "parseStatus" TEXT NOT NULL DEFAULT 'success',
    "parseError" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("contentHash", "createdAt", "createdBy", "frontmatterJson", "id", "kind", "mtime", "parseError", "parseStatus", "path", "projectId", "status", "summary", "taskKey", "title", "updatedAt", "updatedBy") SELECT "contentHash", "createdAt", "createdBy", "frontmatterJson", "id", "kind", "mtime", "parseError", "parseStatus", "path", "projectId", "status", "summary", "taskKey", "title", "updatedAt", "updatedBy" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE UNIQUE INDEX "Document_projectId_path_key" ON "Document"("projectId", "path");
CREATE TABLE "new_Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "outputMode" TEXT NOT NULL DEFAULT 'spec_plan_task',
    "generatedTaskId" TEXT,
    "verbatimSource" TEXT,
    "claudeInterpretation" TEXT,
    "ambiguities" TEXT,
    "fidelityDiff" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Requirement" ("ambiguities", "claudeInterpretation", "createdAt", "createdBy", "description", "fidelityDiff", "generatedTaskId", "id", "outputMode", "projectId", "source", "status", "title", "updatedAt", "updatedBy", "verbatimSource") SELECT "ambiguities", "claudeInterpretation", "createdAt", "createdBy", "description", "fidelityDiff", "generatedTaskId", "id", "outputMode", "projectId", "source", "status", "title", "updatedAt", "updatedBy", "verbatimSource" FROM "Requirement";
DROP TABLE "Requirement";
ALTER TABLE "new_Requirement" RENAME TO "Requirement";
CREATE TABLE "new_SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "logSummary" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SyncJob" ("createdAt", "errorMessage", "finishedAt", "id", "jobType", "logSummary", "projectId", "startedAt", "status", "updatedAt") SELECT "createdAt", "errorMessage", "finishedAt", "id", "jobType", "logSummary", "projectId", "startedAt", "status", "updatedAt" FROM "SyncJob";
DROP TABLE "SyncJob";
ALTER TABLE "new_SyncJob" RENAME TO "SyncJob";
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
    "kind" TEXT NOT NULL DEFAULT 'subtask',
    "parentEpicId" TEXT,
    "specSectionId" TEXT,
    "implementationOwner" TEXT,
    "epicStatus" TEXT,
    "legacyKind" TEXT,
    "legacyParentHint" TEXT,
    "migrationBatchId" TEXT,
    "migrationRuleId" TEXT,
    "migrationConfidence" REAL,
    "migrationReviewedBy" TEXT,
    "migrationReviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_parentEpicId_fkey" FOREIGN KEY ("parentEpicId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeUserId", "blockedReason", "createdAt", "createdBy", "currentNode", "id", "lastTransitionId", "linkedPlanId", "linkedSpecId", "linkedTaskDocId", "nodeSubstate", "ownerUserId", "primaryDocumentId", "priority", "progress", "projectId", "requirementId", "reviewFollowupJson", "reviewStatus", "reviewerUserId", "runtimeState", "stateHashProjection", "stateRevisionSeen", "status", "step", "summary", "taskKey", "title", "updatedAt", "updatedBy", "verificationResultJson") SELECT "assigneeUserId", "blockedReason", "createdAt", "createdBy", "currentNode", "id", "lastTransitionId", "linkedPlanId", "linkedSpecId", "linkedTaskDocId", "nodeSubstate", "ownerUserId", "primaryDocumentId", "priority", "progress", "projectId", "requirementId", "reviewFollowupJson", "reviewStatus", "reviewerUserId", "runtimeState", "stateHashProjection", "stateRevisionSeen", "status", "step", "summary", "taskKey", "title", "updatedAt", "updatedBy", "verificationResultJson" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_parentEpicId_idx" ON "Task"("parentEpicId");
CREATE INDEX "Task_requirementId_kind_idx" ON "Task"("requirementId", "kind");
CREATE INDEX "Task_kind_currentNode_idx" ON "Task"("kind", "currentNode");
CREATE UNIQUE INDEX "Task_projectId_taskKey_key" ON "Task"("projectId", "taskKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "projection_outbox_idempotency_key_key" ON "projection_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "projection_outbox_status_created_at_idx" ON "projection_outbox"("status", "created_at");
