CREATE TABLE IF NOT EXISTS "NodeRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "version" TEXT NOT NULL DEFAULT 'noderun-v0.1',
  "nodeId" TEXT NOT NULL,
  "enteredAt" DATETIME NOT NULL,
  "exitedAt" DATETIME,
  "transitionsJson" TEXT NOT NULL DEFAULT '[]',
  "capabilityDecisionsJson" TEXT NOT NULL DEFAULT '[]',
  "mutationSourcesJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "NodeRun_taskId_enteredAt_idx"
ON "NodeRun"("taskId", "enteredAt");

CREATE INDEX IF NOT EXISTS "NodeRun_nodeId_enteredAt_idx"
ON "NodeRun"("nodeId", "enteredAt");

CREATE TABLE IF NOT EXISTS "CapabilityStatus" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "version" TEXT NOT NULL DEFAULT 'cap-matrix-v0.1',
  "name" TEXT NOT NULL,
  "bindingSource" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "lastUsedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "CapabilityStatus_name_bindingSource_key"
ON "CapabilityStatus"("name", "bindingSource");

CREATE INDEX IF NOT EXISTS "CapabilityStatus_status_idx"
ON "CapabilityStatus"("status");

CREATE INDEX IF NOT EXISTS "CapabilityStatus_bindingSource_status_idx"
ON "CapabilityStatus"("bindingSource", "status");
