ALTER TABLE "Project" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Project" ADD COLUMN "updatedBy" TEXT;

ALTER TABLE "Document" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Document" ADD COLUMN "updatedBy" TEXT;

ALTER TABLE "Task" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Task" ADD COLUMN "assigneeUserId" TEXT;
ALTER TABLE "Task" ADD COLUMN "reviewerUserId" TEXT;
ALTER TABLE "Task" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Task" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Task" ADD COLUMN "stateHashProjection" TEXT;
ALTER TABLE "Task" ADD COLUMN "stateRevisionSeen" INTEGER;

ALTER TABLE "Requirement" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "updatedBy" TEXT;
