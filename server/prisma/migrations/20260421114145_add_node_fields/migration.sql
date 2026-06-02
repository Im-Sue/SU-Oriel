ALTER TABLE "Task" ADD COLUMN "currentNode" TEXT;
ALTER TABLE "Task" ADD COLUMN "nodeSubstate" TEXT;
ALTER TABLE "Task" ADD COLUMN "runtimeState" TEXT DEFAULT 'running';
ALTER TABLE "Task" ADD COLUMN "lastTransitionId" TEXT;
