/*
  Drop Task.phase for KA-6.

  SQLite does not support a simple DROP COLUMN path across all supported
  versions, so this migration rebuilds only the Task table and copies every
  non-phase column unchanged.
*/
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Task" (
    "id",
    "projectId",
    "taskKey",
    "title",
    "summary",
    "status",
    "currentNode",
    "nodeSubstate",
    "runtimeState",
    "lastTransitionId",
    "ownerUserId",
    "assigneeUserId",
    "reviewerUserId",
    "createdBy",
    "updatedBy",
    "stateHashProjection",
    "stateRevisionSeen",
    "priority",
    "progress",
    "step",
    "primaryDocumentId",
    "linkedSpecId",
    "linkedPlanId",
    "linkedTaskDocId",
    "blockedReason",
    "requirementId",
    "reviewStatus",
    "verificationResultJson",
    "reviewFollowupJson",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "projectId",
    "taskKey",
    "title",
    "summary",
    "status",
    "currentNode",
    "nodeSubstate",
    "runtimeState",
    "lastTransitionId",
    "ownerUserId",
    "assigneeUserId",
    "reviewerUserId",
    "createdBy",
    "updatedBy",
    "stateHashProjection",
    "stateRevisionSeen",
    "priority",
    "progress",
    "step",
    "primaryDocumentId",
    "linkedSpecId",
    "linkedPlanId",
    "linkedTaskDocId",
    "blockedReason",
    "requirementId",
    "reviewStatus",
    "verificationResultJson",
    "reviewFollowupJson",
    "createdAt",
    "updatedAt"
FROM "Task";

DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";

CREATE UNIQUE INDEX "Task_projectId_taskKey_key" ON "Task"("projectId", "taskKey");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
