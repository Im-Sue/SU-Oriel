-- F4 phase 1: carrier uniqueness modeling for Requirement materialization.
CREATE TABLE "RequirementMaterialization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requirementId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RequirementMaterialization_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RequirementMaterialization_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RequirementMaterialization_requirementId_key"
  ON "RequirementMaterialization"("requirementId");

CREATE UNIQUE INDEX "RequirementMaterialization_taskId_key"
  ON "RequirementMaterialization"("taskId");
