-- AlterTable
ALTER TABLE "SchedulerConsumerCursor" ADD COLUMN "activeBranchSetId" TEXT;

-- CreateTable
CREATE TABLE "SchedulerBranchState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "branchSetId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastEventId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulerBranchState_taskId_branchSetId_branchId_key" ON "SchedulerBranchState"("taskId", "branchSetId", "branchId");

-- CreateIndex
CREATE INDEX "SchedulerBranchState_taskId_status_idx" ON "SchedulerBranchState"("taskId", "status");
