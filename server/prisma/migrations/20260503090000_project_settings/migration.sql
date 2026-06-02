CREATE TABLE IF NOT EXISTS "ProjectSettings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "scan_strategy" TEXT NOT NULL,
  "parsing_rules" TEXT NOT NULL,
  "path_config" TEXT NOT NULL,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "ProjectSettings_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectSettings_projectId_key"
ON "ProjectSettings"("projectId");
