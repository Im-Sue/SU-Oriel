import assert from "node:assert/strict";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";

async function clearHookAuditLogs(): Promise<void> {
  try {
    await prisma.hookAuditLog.deleteMany();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("does not exist")) {
      throw error;
    }
  }
}

afterEach(async () => {
  await clearHookAuditLogs();
});

test("POST /api/hooks/pre-task-create returns demo success and writes an audit log", async () => {
  const app = buildApp();
  await clearHookAuditLogs();

  const response = await app.inject({
    method: "POST",
    url: "/api/hooks/pre-task-create",
    payload: {
      project_id: "project-hook-demo",
      task_key: "task-hook-demo",
      title: "Hook demo task",
      source: "unit-test"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.mode, "demo");
  assert.equal(body.hook_name, "pre-task-create");
  assert.equal(typeof body.audit_log_id, "string");

  const auditLog = await prisma.hookAuditLog.findUnique({
    where: {
      id: String(body.audit_log_id)
    }
  });

  assert.ok(auditLog);
  assert.equal(auditLog.hookName, "pre-task-create");
  assert.equal(typeof auditLog.triggeredAt.toISOString(), "string");
  assert.deepEqual(JSON.parse(auditLog.payloadSnapshotJson), {
    project_id: "project-hook-demo",
    task_key: "task-hook-demo",
    title: "Hook demo task",
    source: "unit-test"
  });
  assert.deepEqual(JSON.parse(auditLog.outcomeJson), {
    ok: true,
    mode: "demo",
    state_mutation: false,
    kernel_command: false
  });

  await app.close();
});

test("POST /api/hooks/pre-task-create rejects invalid payloads", async () => {
  const app = buildApp();
  await clearHookAuditLogs();

  const response = await app.inject({
    method: "POST",
    url: "/api/hooks/pre-task-create",
    payload: {
      project_id: "project-hook-demo",
      task_key: "",
      title: "Hook demo task"
    }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as Record<string, unknown>;
  assert.equal(body.message, "hook payload 参数不合法");
  assert.ok(Array.isArray(body.issues));

  const auditCount = await prisma.hookAuditLog.count();
  assert.equal(auditCount, 0);

  await app.close();
});

test("POST /api/hooks/pre-task-create keeps the demo envelope no-op", async () => {
  const app = buildApp();
  await clearHookAuditLogs();

  const response = await app.inject({
    method: "POST",
    url: "/api/hooks/pre-task-create",
    payload: {
      project_id: "project-hook-demo",
      task_key: "task-hook-demo-noop",
      title: "No-op hook demo"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as Record<string, unknown>;
  assert.deepEqual(
    {
      ok: body.ok,
      mode: body.mode,
      hook_name: body.hook_name,
      state_mutation: body.state_mutation,
      kernel_command: body.kernel_command
    },
    {
      ok: true,
      mode: "demo",
      hook_name: "pre-task-create",
      state_mutation: false,
      kernel_command: false
    }
  );

  await app.close();
});
