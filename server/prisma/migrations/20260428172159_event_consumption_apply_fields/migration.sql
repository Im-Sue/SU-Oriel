ALTER TABLE "EventConsumption" ADD COLUMN "appliedAt" DATETIME;
ALTER TABLE "EventConsumption" ADD COLUMN "stateRevisionBefore" INTEGER;
ALTER TABLE "EventConsumption" ADD COLUMN "stateRevisionAfter" INTEGER;
ALTER TABLE "EventConsumption" ADD COLUMN "idempotencyKey" TEXT;

CREATE INDEX "EventConsumption_eventId_mode_result_idx"
ON "EventConsumption"("eventId", "mode", "result");
