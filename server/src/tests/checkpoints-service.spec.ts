import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test, vi } from "vitest";

import { prisma } from "../db/prisma.js";
import { evictOldCheckpoints, getCheckpoint, writeCheckpointForTransitionForTest } from "../modules/checkpoints/checkpoints.service.js";

async function resetData() {
  await prisma.taskCheckpoint.deleteMany(); await prisma.eventJournal.deleteMany();
  await prisma.task.deleteMany(); await prisma.project.deleteMany();
}
async function fixture(currentNode = "dispatch") {
  const project = await prisma.project.create({ data: { name: `Checkpoint ${randomUUID()}`, localPath: join(tmpdir(), `ccb-checkpoint-${randomUUID()}`), updatedAt: new Date() } });
  const task = await prisma.task.create({ data: { projectId: project.id, taskKey: `task-${randomUUID()}`, title: "Checkpoint task", status: "reviewing", currentNode, nodeSubstate: "awaiting_codex_pickup", runtimeState: "waiting_codex", updatedAt: new Date() } });
  return { project, task };
}
async function cp(fx: Awaited<ReturnType<typeof fixture>>, n = 1, overrides = {}) {
  return await writeCheckpointForTransitionForTest({ projectLocalPath: fx.project.localPath, taskId: fx.task.id, taskKey: fx.task.taskKey, transitionId: `transition-${n}`, nodeBefore: "dispatch", nodeAfter: "implementation", stateRevisionAfter: n, snapshot: { currentNode: "implementation", stateRevisionSeen: n }, ...overrides });
}
async function waitForPath(id: string) {
  for (let i = 0; i < 40; i += 1) {
    const row = await prisma.taskCheckpoint.findUnique({ where: { id } });
    if (row?.snapshotPath && !row.snapshotPath.startsWith("pending:")) return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("snapshot path not persisted");
}

afterEach(async () => { vi.restoreAllMocks(); await resetData(); });

test("large checkpoint snapshots degrade to file storage", async () => {
  const fx = await fixture();
  const checkpoint = await cp(fx, 8, { transitionId: "large", snapshot: { currentNode: "implementation", large: "x".repeat(210 * 1024) } });
  const stored = await waitForPath(checkpoint.id);
  assert.equal(stored.snapshotInline, null);
  await access(join(fx.project.localPath, stored.snapshotPath ?? ""));
  assert.equal(((await getCheckpoint(fx.task.id, "large"))?.snapshot?.large as string).length, 210 * 1024);
});

test("evictOldCheckpoints caps old done-node rows and keeps current node rows", async () => {
  const fx = await fixture("implementation");
  for (let i = 0; i < 55; i += 1) await cp(fx, i, { nodeAfter: i % 10 === 0 ? "implementation" : "review" });
  assert.equal(await evictOldCheckpoints(fx.task.id), 5);
  assert.equal(await prisma.taskCheckpoint.count({ where: { taskId: fx.task.id } }), 50);
  assert.equal(await prisma.taskCheckpoint.count({ where: { taskId: fx.task.id, nodeAfter: "implementation" } }), 6);
});

test("getCheckpoint returns null for another task transition", async () => {
  const first = await fixture(); const second = await fixture();
  await cp(first, 1, { transitionId: "shared-transition" });
  assert.equal(await getCheckpoint(second.task.id, "shared-transition"), null);
});
