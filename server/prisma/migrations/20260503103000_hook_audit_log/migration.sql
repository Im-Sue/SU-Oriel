CREATE TABLE IF NOT EXISTS "HookAuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "hook_name" TEXT NOT NULL,
  "triggered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload_snapshot" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "HookAuditLog_hook_name_triggered_at_idx"
ON "HookAuditLog"("hook_name", "triggered_at");
