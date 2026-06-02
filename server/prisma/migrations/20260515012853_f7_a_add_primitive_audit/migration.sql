-- CreateTable
CREATE TABLE "PrimitiveAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "primitive" TEXT NOT NULL,
    "mutationType" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL,
    "resultJson" TEXT,
    "errorJson" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "durationMs" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "PrimitiveAudit_idempotencyKey_key" ON "PrimitiveAudit"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrimitiveAudit_primitive_startedAt_idx" ON "PrimitiveAudit"("primitive", "startedAt");

-- CreateIndex
CREATE INDEX "PrimitiveAudit_status_startedAt_idx" ON "PrimitiveAudit"("status", "startedAt");
