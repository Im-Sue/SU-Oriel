CREATE UNIQUE INDEX IF NOT EXISTS "EventConsumption_apply_applied_event_transition_unique"
ON "EventConsumption"("eventId", "transitionId", "mode")
WHERE "mode" = 'apply' AND "result" = 'applied';
