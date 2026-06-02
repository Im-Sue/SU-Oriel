CREATE TABLE IF NOT EXISTS "Project" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "localPath" TEXT NOT NULL,
  "summary" TEXT,
  "initStatus" TEXT NOT NULL DEFAULT 'not_initialized',
  "docsRoot" TEXT,
  "lastScanAt" DATETIME,
  "syncStatus" TEXT NOT NULL DEFAULT 'idle',
  "ownerUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Project_localPath_key" ON "Project"("localPath");

CREATE TABLE IF NOT EXISTS "Document" (
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
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Document_projectId_path_key" ON "Document"("projectId", "path");

CREATE TABLE IF NOT EXISTS "Task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "phase" TEXT NOT NULL DEFAULT 'planning',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "step" INTEGER,
  "primaryDocumentId" TEXT,
  "linkedSpecId" TEXT,
  "linkedPlanId" TEXT,
  "linkedTaskDocId" TEXT,
  "blockedReason" TEXT,
  "requirementId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Task_projectId_taskKey_key" ON "Task"("projectId", "taskKey");

CREATE TABLE IF NOT EXISTS "Requirement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "outputMode" TEXT NOT NULL DEFAULT 'spec_plan_task',
  "generatedTaskId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AiCliSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scope" TEXT NOT NULL,
  "projectId" TEXT,
  "toolId" TEXT NOT NULL,
  "command" TEXT,
  "extraArgs" TEXT,
  "defaultMode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiCliSetting_scope_projectId_toolId_key"
ON "AiCliSetting"("scope", "projectId", "toolId");

CREATE TABLE IF NOT EXISTS "SyncJob" (
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
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
);
