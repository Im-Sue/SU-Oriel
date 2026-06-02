CREATE TABLE "RequirementEditAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "editor" TEXT NOT NULL,
  "changeReason" TEXT,
  "beforeTitle" TEXT NOT NULL,
  "afterTitle" TEXT NOT NULL,
  "beforeDescription" TEXT NOT NULL,
  "afterDescription" TEXT NOT NULL,
  "beforeMdHash" TEXT NOT NULL,
  "afterMdHash" TEXT NOT NULL,
  "diffJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequirementEditAudit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RequirementEditAudit_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RequirementEditAudit_requirementId_createdAt_idx"
ON "RequirementEditAudit"("requirementId", "createdAt");

CREATE INDEX "RequirementEditAudit_projectId_createdAt_idx"
ON "RequirementEditAudit"("projectId", "createdAt");

CREATE INDEX "RequirementEditAudit_editor_createdAt_idx"
ON "RequirementEditAudit"("editor", "createdAt");
