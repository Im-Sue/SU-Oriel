-- TA4 · cross-anchor-timeline: add anchor_id / epic_task_id dimensions to EventJournal.
-- Backfill semantics: existing rows pre-TA4 stay anchor_id=NULL (主 anchor 默认)
-- and epic_task_id=NULL (legacy events without epic linkage).
ALTER TABLE "EventJournal" ADD COLUMN "anchor_id" TEXT;
ALTER TABLE "EventJournal" ADD COLUMN "epic_task_id" TEXT;

CREATE INDEX "EventJournal_anchor_id_emittedAt_idx" ON "EventJournal"("anchor_id", "emittedAt");
CREATE INDEX "EventJournal_epic_task_id_emittedAt_idx" ON "EventJournal"("epic_task_id", "emittedAt");
