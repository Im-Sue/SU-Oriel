import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import { prisma } from "../../db/prisma.js";
import { SlotBindingService } from "./slot-binding.service.js";
import { SlotStaleDetector } from "./slot-stale-detector.js";

const tmpRoots: string[] = [];

async function resetDatabase(): Promise<void> {
  await prisma.hookAuditLog.deleteMany();
  await prisma.eventJournal.deleteMany();
  await prisma.slotBinding.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.project.deleteMany();
}

async function createBoundSlotFixture() {
  const root = await mkdtemp(join(tmpdir(), "ccb-slot-stale-"));
  tmpRoots.push(root);
  const project = await prisma.project.create({
    data: {
      name: `slot-stale-${randomUUID()}`,
      localPath: root
    }
  });
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      title: "Stale requirement",
      description: "Stale detector fixture",
      status: "planning"
    }
  });
  const service = new SlotBindingService(prisma);
  const binding = await service.bindRequirement({ projectId: project.id, requirementId: requirement.id });
  return { project, requirement, binding };
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
  tmpRoots.length = 0;
});

test("SlotStaleDetector creates default policy and marks stale without release", async () => {
  const { project, binding } = await createBoundSlotFixture();
  await prisma.slotBinding.update({
    where: { id: binding.id },
    data: { lastActivityAt: new Date("2026-05-01T00:00:00.000Z") }
  });
  const notify = vi.fn(async () => undefined);
  const detector = new SlotStaleDetector({
    prismaClient: prisma,
    notify,
    now: () => new Date("2026-05-10T00:00:00.000Z")
  });

  const result = await detector.runOnce(project.id);

  assert.equal(result.staleMarked, 1);
  assert.equal(result.busyTimedOut, 0);
  assert.equal(notify.mock.calls.length, 1);
  const updated = await prisma.slotBinding.findUniqueOrThrow({ where: { id: binding.id } });
  assert.equal(updated.state, "bound");
  assert.equal(updated.requirementId, binding.requirementId);
  assert.equal(updated.staleNotifiedCount, 1);
  assert.equal(updated.staleDetectedAt?.toISOString(), "2026-05-10T00:00:00.000Z");
  const policy = await readFile(join(project.localPath, "docs", ".ccb", "config", "slot-stale-policy.yaml"), "utf8");
  assert.match(policy, /stale_threshold_days: 7/);
  assert.match(policy, /busy_timeout_hours: 4/);
});

test("SlotStaleDetector marks busy timeout unhealthy and emits slot_runtime_degraded", async () => {
  const { project, binding } = await createBoundSlotFixture();
  await prisma.slotBinding.update({
    where: { id: binding.id },
    data: {
      state: "busy",
      busySince: new Date("2026-05-10T00:00:00.000Z"),
      lastActivityAt: new Date("2026-05-10T00:00:00.000Z")
    }
  });
  const detector = new SlotStaleDetector({
    prismaClient: prisma,
    notify: vi.fn(async () => undefined),
    now: () => new Date("2026-05-10T05:00:00.000Z")
  });

  const result = await detector.runOnce(project.id);

  assert.equal(result.busyTimedOut, 1);
  const updated = await prisma.slotBinding.findUniqueOrThrow({ where: { id: binding.id } });
  assert.equal(updated.state, "unhealthy");
  assert.equal(updated.requirementId, binding.requirementId);
  const event = await prisma.eventJournal.findFirstOrThrow({ where: { eventType: "slot_runtime_degraded" } });
  assert.equal(event.anchorId, binding.slotId);
  assert.deepEqual(JSON.parse(event.payloadJson), {
    slotId: binding.slotId,
    reason: "busy_timeout",
    severity: "error"
  });
});

test("SlotStaleDetector sends default hook notification for stale slots", async () => {
  const { project, binding } = await createBoundSlotFixture();
  await prisma.slotBinding.update({
    where: { id: binding.id },
    data: { lastActivityAt: new Date("2026-05-01T00:00:00.000Z") }
  });
  const detector = new SlotStaleDetector({
    prismaClient: prisma,
    now: () => new Date("2026-05-10T00:00:00.000Z")
  });

  await detector.runOnce(project.id);

  const hook = await prisma.hookAuditLog.findFirstOrThrow({
    where: { hookName: "slot-stale-detector" }
  });
  assert.deepEqual(JSON.parse(hook.payloadSnapshotJson), {
    project_id: project.id,
    slot_id: binding.slotId,
    requirement_id: binding.requirementId,
    kind: "stale",
    detected_at: "2026-05-10T00:00:00.000Z"
  });
  assert.deepEqual(JSON.parse(hook.outcomeJson), {
    ok: true,
    mode: "notify",
    state_mutation: false,
    kernel_command: false
  });
});

test("SlotStaleDetector sends default hook notification for busy timeout slots", async () => {
  const { project, binding } = await createBoundSlotFixture();
  await prisma.slotBinding.update({
    where: { id: binding.id },
    data: {
      state: "busy",
      busySince: new Date("2026-05-10T00:00:00.000Z"),
      lastActivityAt: new Date("2026-05-10T00:00:00.000Z")
    }
  });
  const detector = new SlotStaleDetector({
    prismaClient: prisma,
    now: () => new Date("2026-05-10T05:00:00.000Z")
  });

  await detector.runOnce(project.id);

  const hook = await prisma.hookAuditLog.findFirstOrThrow({
    where: { hookName: "slot-stale-detector" }
  });
  assert.deepEqual(JSON.parse(hook.payloadSnapshotJson), {
    project_id: project.id,
    slot_id: binding.slotId,
    requirement_id: binding.requirementId,
    kind: "busy_timeout",
    detected_at: "2026-05-10T05:00:00.000Z"
  });
});

test("SlotStaleDetector keeps stale state updates when hook notify fails", async () => {
  const { project, binding } = await createBoundSlotFixture();
  await prisma.slotBinding.update({
    where: { id: binding.id },
    data: { lastActivityAt: new Date("2026-05-01T00:00:00.000Z") }
  });
  const warn = vi.fn();
  const detector = new SlotStaleDetector({
    prismaClient: prisma,
    notify: vi.fn(async () => {
      throw new Error("hook unavailable");
    }),
    logger: { warn },
    now: () => new Date("2026-05-10T00:00:00.000Z")
  });

  const result = await detector.runOnce(project.id);

  assert.equal(result.staleMarked, 1);
  const updated = await prisma.slotBinding.findUniqueOrThrow({ where: { id: binding.id } });
  assert.equal(updated.state, "bound");
  assert.equal(updated.staleNotifiedCount, 1);
  assert.equal(updated.staleDetectedAt?.toISOString(), "2026-05-10T00:00:00.000Z");
  assert.equal(warn.mock.calls.length, 1);
});

test("SlotStaleDetector keeps busy timeout state and event when hook notify fails", async () => {
  const { project, binding } = await createBoundSlotFixture();
  await prisma.slotBinding.update({
    where: { id: binding.id },
    data: {
      state: "busy",
      busySince: new Date("2026-05-10T00:00:00.000Z"),
      lastActivityAt: new Date("2026-05-10T00:00:00.000Z")
    }
  });
  const warn = vi.fn();
  const detector = new SlotStaleDetector({
    prismaClient: prisma,
    notify: vi.fn(async () => {
      throw new Error("hook unavailable");
    }),
    logger: { warn },
    now: () => new Date("2026-05-10T05:00:00.000Z")
  });

  const result = await detector.runOnce(project.id);

  assert.equal(result.busyTimedOut, 1);
  const updated = await prisma.slotBinding.findUniqueOrThrow({ where: { id: binding.id } });
  assert.equal(updated.state, "unhealthy");
  assert.equal(updated.staleNotifiedCount, 1);
  assert.equal(updated.staleDetectedAt?.toISOString(), "2026-05-10T05:00:00.000Z");
  assert.equal(await prisma.eventJournal.count({ where: { eventType: "slot_runtime_degraded" } }), 1);
  assert.equal(warn.mock.calls.length, 1);
});
