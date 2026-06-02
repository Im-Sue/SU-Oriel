CREATE TABLE IF NOT EXISTS "RoleProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "executor_profile_id" TEXT NOT NULL,
  "prompt_template_ref" TEXT NOT NULL,
  "variable_overrides" TEXT NOT NULL,
  "version" TEXT NOT NULL DEFAULT 'role-profile-v0.1',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "RoleProfile_executor_profile_id_fkey"
    FOREIGN KEY ("executor_profile_id") REFERENCES "ExecutorProfile" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "RoleProfile_executor_profile_id_name_key"
ON "RoleProfile"("executor_profile_id", "name");

CREATE INDEX IF NOT EXISTS "RoleProfile_prompt_template_ref_idx"
ON "RoleProfile"("prompt_template_ref");
