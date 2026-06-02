-- v0.5 ST5 · user_intent: 用户在任务中途介入（停止 / 追加 / 换方向），等 resume 时被 AI 读取
CREATE TABLE "user_intent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "ccb_job_id" TEXT,
    "intent_type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" DATETIME,
    CONSTRAINT "user_intent_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "user_intent_task_id_consumed_at_idx" ON "user_intent"("task_id", "consumed_at");
