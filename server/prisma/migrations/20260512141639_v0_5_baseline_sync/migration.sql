-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "capacity" INTEGER,
    "burndownDataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_parentEpicId_fkey" FOREIGN KEY ("parentEpicId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeUserId", "blockedReason", "createdAt", "createdBy", "currentNode", "epicStatus", "id", "implementationOwner", "kind", "lastTransitionId", "legacyKind", "legacyParentHint", "linkedPlanId", "linkedSpecId", "linkedTaskDocId", "migrationBatchId", "migrationConfidence", "migrationReviewedAt", "migrationReviewedBy", "migrationRuleId", "nodeSubstate", "ownerUserId", "parentEpicId", "primaryDocumentId", "priority", "progress", "projectId", "requirementId", "reviewFollowupJson", "reviewStatus", "reviewerUserId", "runtimeState", "specSectionId", "stateHashProjection", "stateRevisionSeen", "status", "step", "summary", "taskKey", "title", "updatedAt", "updatedBy", "verificationResultJson") SELECT "assigneeUserId", "blockedReason", "createdAt", "createdBy", "currentNode", "epicStatus", "id", "implementationOwner", "kind", "lastTransitionId", "legacyKind", "legacyParentHint", "linkedPlanId", "linkedSpecId", "linkedTaskDocId", "migrationBatchId", "migrationConfidence", "migrationReviewedAt", "migrationReviewedBy", "migrationRuleId", "nodeSubstate", "ownerUserId", "parentEpicId", "primaryDocumentId", "priority", "progress", "projectId", "requirementId", "reviewFollowupJson", "reviewStatus", "reviewerUserId", "runtimeState", "specSectionId", "stateHashProjection", "stateRevisionSeen", "status", "step", "summary", "taskKey", "title", "updatedAt", "updatedBy", "verificationResultJson" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_parentEpicId_idx" ON "Task"("parentEpicId");
CREATE INDEX "Task_requirementId_kind_idx" ON "Task"("requirementId", "kind");
CREATE INDEX "Task_kind_currentNode_idx" ON "Task"("kind", "currentNode");
CREATE INDEX "Task_sprintId_idx" ON "Task"("sprintId");
CREATE UNIQUE INDEX "Task_projectId_taskKey_key" ON "Task"("projectId", "taskKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Sprint_projectId_status_idx" ON "Sprint"("projectId", "status");
