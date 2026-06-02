CREATE TABLE IF NOT EXISTS "ExecutorProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "runtime" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "capability_binding" TEXT NOT NULL,
  "version" TEXT NOT NULL DEFAULT 'executor-profile-v0.1',
  "meta" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "ExecutorProfile_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExecutorProfile_projectId_name_key"
ON "ExecutorProfile"("projectId", "name");

CREATE INDEX IF NOT EXISTS "ExecutorProfile_provider_model_idx"
ON "ExecutorProfile"("provider", "model");

CREATE INDEX IF NOT EXISTS "ExecutorProfile_runtime_idx"
ON "ExecutorProfile"("runtime");

CREATE INDEX IF NOT EXISTS "ExecutorProfile_permission_idx"
ON "ExecutorProfile"("permission");
