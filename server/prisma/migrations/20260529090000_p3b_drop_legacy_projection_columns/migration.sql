-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "source" TEXT NOT NULL DEFAULT 'manual',
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
    "planDocPath" TEXT,
    "breakdownDraftPath" TEXT,
    "planningAnchorId" TEXT,
    "rollupProgress" INTEGER NOT NULL DEFAULT 0,
    "rollupStatus" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Requirement" ("ambiguities", "analysisInputHash", "analysisStaleAt", "breakdownDraftPath", "claudeInterpretation", "createdAt", "createdBy", "currentPlanningNode", "currentPlanningStep", "description", "fidelityDiff", "id", "lastPlanningTransitionId", "planDocPath", "planningAnchorId", "planningRuntimeState", "planningSubstate", "projectId", "rollupProgress", "rollupStatus", "source", "status", "title", "updatedAt", "updatedBy", "verbatimSource") SELECT "ambiguities", "analysisInputHash", "analysisStaleAt", "breakdownDraftPath", "claudeInterpretation", "createdAt", "createdBy", "currentPlanningNode", "currentPlanningStep", "description", "fidelityDiff", "id", "lastPlanningTransitionId", "planDocPath", "planningAnchorId", "planningRuntimeState", "planningSubstate", "projectId", "rollupProgress", "rollupStatus", "source", "status", "title", "updatedAt", "updatedBy", "verbatimSource" FROM "Requirement";
DROP TABLE "Requirement";
ALTER TABLE "new_Requirement" RENAME TO "Requirement";
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
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "primaryDocumentId" TEXT,
    "blockedReason" TEXT,
    "requirementId" TEXT,
    "reviewStatus" TEXT,
    "verificationResultJson" TEXT,
    "reviewFollowupJson" TEXT,
    "specSectionId" TEXT,
    "implementationOwner" TEXT,
    "sprintId" TEXT,
    "storyPoints" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeUserId", "blockedReason", "createdAt", "createdBy", "currentNode", "id", "implementationOwner", "lastTransitionId", "nodeSubstate", "ownerUserId", "primaryDocumentId", "priority", "progress", "projectId", "requirementId", "reviewFollowupJson", "reviewStatus", "reviewerUserId", "runtimeState", "specSectionId", "sprintId", "status", "storyPoints", "summary", "taskKey", "title", "updatedAt", "updatedBy", "verificationResultJson") SELECT "assigneeUserId", "blockedReason", "createdAt", "createdBy", "currentNode", "id", "implementationOwner", "lastTransitionId", "nodeSubstate", "ownerUserId", "primaryDocumentId", "priority", "progress", "projectId", "requirementId", "reviewFollowupJson", "reviewStatus", "reviewerUserId", "runtimeState", "specSectionId", "sprintId", "status", "storyPoints", "summary", "taskKey", "title", "updatedAt", "updatedBy", "verificationResultJson" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_requirementId_currentNode_idx" ON "Task"("requirementId", "currentNode");
CREATE INDEX "Task_currentNode_idx" ON "Task"("currentNode");
CREATE INDEX "Task_sprintId_idx" ON "Task"("sprintId");
CREATE UNIQUE INDEX "Task_projectId_taskKey_key" ON "Task"("projectId", "taskKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
