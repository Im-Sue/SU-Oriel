import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test } from "vitest";

import { prisma } from "../../db/prisma.js";
import {
  computeSlotTipsProjection,
  SLOT_TIP_TITLE_MAX_CHARS,
  syncSlotTips
} from "./slot-tips-projection.service.js";

const tmpRoots: string[] = [];

async function resetDatabase(): Promise<void> {
  await prisma.anchorDispatchQueue.deleteMany();
  await prisma.eventJournal.deleteMany();
  await prisma.slotBinding.deleteMany();
  await prisma.anchorAllocation.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.project.deleteMany();
}

async function createProjectWithRoot(): Promise<{ projectId: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "ccb-slot-tips-"));
  tmpRoots.push(root);
  const project = await prisma.project.create({
    data: {
      name: `slot-tips-${randomUUID()}`,
      localPath: root
    }
  });
  return { projectId: project.id, root };
}

async function createRequirement(projectId: string, title: string) {
  return await prisma.requirement.create({
    data: {
      projectId,
      title,
      description: "slot tips fixture",
      status: "planning"
    }
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
  tmpRoots.length = 0;
});

test("computeSlotTipsProjection includes active requirement bindings sorted by slot id with truncated titles", async () => {
  const { projectId } = await createProjectWithRoot();
  const longTitle = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const activeOne = await createRequirement(projectId, longTitle);
  const activeTwo = await createRequirement(projectId, "中文标题");
  const idle = await createRequirement(projectId, "Idle Requirement");
  const draining = await createRequirement(projectId, "Draining Requirement");

  await prisma.slotBinding.create({
    data: { projectId, slotId: "slot-2", requirementId: activeTwo.id, state: "busy" }
  });
  await prisma.slotBinding.create({
    data: { projectId, slotId: "slot-1", requirementId: activeOne.id, state: "bound" }
  });
  await prisma.slotBinding.create({
    data: { projectId, slotId: "slot-3", requirementId: idle.id, state: "idle" }
  });
  await prisma.slotBinding.create({
    data: { projectId, slotId: "slot-4", requirementId: draining.id, state: "draining" }
  });
  await prisma.slotBinding.create({
    data: { projectId, slotId: "slot-5", state: "recovering" }
  });

  const tips = await computeSlotTipsProjection(prisma, projectId);

  assert.deepEqual(tips, [
    `slot-1: ${longTitle.slice(0, SLOT_TIP_TITLE_MAX_CHARS - 3)}...`,
    "slot-2: 中文标题"
  ]);
});

test("syncSlotTips writes a full managed projection and clears to an empty tips array", async () => {
  const { projectId, root } = await createProjectWithRoot();
  const requirement = await createRequirement(projectId, "Projected Requirement");
  await prisma.slotBinding.create({
    data: { projectId, slotId: "slot-1", requirementId: requirement.id, state: "bound" }
  });

  const written = await syncSlotTips(projectId, { client: prisma });

  assert.equal(written.status, "ok");
  let config = await readFile(join(root, ".ccb", "ccb.config"), "utf8");
  assert.match(config, /^\[ui\.sidebar\.view]$/m);
  assert.match(config, /"slot-1: Projected Requirement"/);

  await prisma.slotBinding.update({
    where: { projectId_slotId: { projectId, slotId: "slot-1" } },
    data: { requirementId: null, state: "idle" }
  });
  const cleared = await syncSlotTips(projectId, { client: prisma });

  assert.equal(cleared.status, "ok");
  config = await readFile(join(root, ".ccb", "ccb.config"), "utf8");
  assert.match(config, /^tips = \[]$/m);
  assert.doesNotMatch(config, /Projected Requirement/);
});

test("syncSlotTips serializes concurrent syncs through a project lock", async () => {
  const { projectId, root } = await createProjectWithRoot();
  const first = await createRequirement(projectId, "First");
  const second = await createRequirement(projectId, "Second");
  await prisma.slotBinding.create({
    data: { projectId, slotId: "slot-1", requirementId: first.id, state: "bound" }
  });
  await prisma.slotBinding.create({
    data: { projectId, slotId: "slot-2", requirementId: second.id, state: "bound" }
  });

  const results = await Promise.all([
    syncSlotTips(projectId, { client: prisma }),
    syncSlotTips(projectId, { client: prisma })
  ]);

  assert.deepEqual(results.map((result) => result.status), ["ok", "ok"]);
  const config = await readFile(join(root, ".ccb", "ccb.config"), "utf8");
  assert.match(config, /"slot-1: First"/);
  assert.match(config, /"slot-2: Second"/);
});
