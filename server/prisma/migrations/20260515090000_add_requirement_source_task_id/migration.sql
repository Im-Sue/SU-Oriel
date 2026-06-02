-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "outputMode" TEXT NOT NULL DEFAULT 'spec_plan_task',
    "split_mode" TEXT NOT NULL DEFAULT 'direct_pr',
    "generatedTaskId" TEXT,
    "sourceTaskId" TEXT,
    "verbatimSource" TEXT,
    "claudeInterpretation" TEXT,
    "ambiguities" TEXT,
    "fidelityDiff" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Requirement_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Requirement" (
    "ambiguities",
    "claudeInterpretation",
    "createdAt",
    "createdBy",
    "description",
    "fidelityDiff",
    "generatedTaskId",
    "id",
    "outputMode",
    "projectId",
    "source",
    "split_mode",
    "status",
    "title",
    "updatedAt",
    "updatedBy",
    "verbatimSource"
)
SELECT
    "ambiguities",
    "claudeInterpretation",
    "createdAt",
    "createdBy",
    "description",
    "fidelityDiff",
    "generatedTaskId",
    "id",
    "outputMode",
    "projectId",
    "source",
    "split_mode",
    "status",
    "title",
    "updatedAt",
    "updatedBy",
    "verbatimSource"
FROM "Requirement";

DROP TABLE "Requirement";
ALTER TABLE "new_Requirement" RENAME TO "Requirement";
CREATE INDEX "Requirement_split_mode_idx" ON "Requirement"("split_mode");
CREATE INDEX "Requirement_sourceTaskId_idx" ON "Requirement"("sourceTaskId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
