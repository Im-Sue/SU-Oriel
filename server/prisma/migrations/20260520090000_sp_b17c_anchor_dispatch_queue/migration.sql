-- CreateTable
CREATE TABLE "AnchorDispatchQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "anchorId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "failedAt" DATETIME,
    "errorMessage" TEXT,
    "readinessWarning" BOOLEAN
);

-- CreateIndex
CREATE UNIQUE INDEX "AnchorDispatchQueue_jobId_key" ON "AnchorDispatchQueue"("jobId");

-- CreateIndex
CREATE INDEX "AnchorDispatchQueue_status_queuedAt_idx" ON "AnchorDispatchQueue"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "AnchorDispatchQueue_subjectType_subjectId_idx" ON "AnchorDispatchQueue"("subjectType", "subjectId");
