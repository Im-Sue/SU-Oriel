import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, test } from "vitest";

import { prisma } from "../../db/prisma.js";
import { JobSlotRouter } from "./job-slot-router.js";
import { SlotBindingService } from "./slot-binding.service.js";

async function resetDatabase(): Promise<void> {
  await prisma.anchorDispatchQueue.deleteMany();
  await prisma.eventJournal.deleteMany();
  await prisma.slotBinding.deleteMany();
  await prisma.anchorAllocation.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.project.deleteMany();
}

async function createProjectWithRequirements(count: number) {
  const project = await prisma.project.create({
    data: {
      name: `slot-binding-${randomUUID()}`,
      localPath: join(tmpdir(), `slot-binding-${randomUUID()}`)
    }
  });
  const requirements = [];
  for (let index = 0; index < count; index++) {
    requirements.push(
      await prisma.requirement.create({
        data: {
          projectId: project.id,
          title: `Requirement ${index + 1}`,
          description: "Slot binding fixture",
          status: "planning"
        }
      })
    );
  }
  return { project, requirements };
}

beforeEach(async () => {
  await resetDatabase();
});

test("SlotBindingService claims deterministic slots and preserves sticky requirement binding", async () => {
  const { project, requirements } = await createProjectWithRequirements(2);
  const service = new SlotBindingService(prisma);

  const first = await service.bindRequirement({
    projectId: project.id,
    requirementId: requirements[0].id
  });
  const again = await service.bindRequirement({
    projectId: project.id,
    requirementId: requirements[0].id
  });
  const second = await service.bindRequirement({
    projectId: project.id,
    requirementId: requirements[1].id
  });

  assert.equal(first.slotId, "slot-1");
  assert.equal(again.slotId, "slot-1");
  assert.equal(second.slotId, "slot-2");
  assert.equal(await prisma.eventJournal.count({ where: { eventType: "slot_bound" } }), 2);
});

test("SlotBindingService runs the slot-bound callback after commit and keeps binding when it fails", async () => {
  const { project, requirements } = await createProjectWithRequirements(1);
  const calls: Array<{ projectId: string; slotId: string; requirementId: string; committed: boolean }> = [];
  const service = new SlotBindingService(prisma, {
    onSlotBound: async (input) => {
      const row = await prisma.slotBinding.findUnique({
        where: {
          projectId_slotId: {
            projectId: input.projectId,
            slotId: input.slotId
          }
        }
      });
      calls.push({
        ...input,
        committed: row?.requirementId === input.requirementId
      });
      throw new Error("reset failed");
    }
  });

  const bound = await service.bindRequirement({
    projectId: project.id,
    requirementId: requirements[0].id
  });
  const sticky = await service.bindRequirement({
    projectId: project.id,
    requirementId: requirements[0].id
  });

  assert.equal(bound?.slotId, "slot-1");
  assert.equal(sticky?.slotId, "slot-1");
  assert.deepEqual(calls, [
    {
      projectId: project.id,
      slotId: "slot-1",
      requirementId: requirements[0].id,
      committed: true
    }
  ]);
  assert.equal(await prisma.slotBinding.count({ where: { projectId: project.id, requirementId: requirements[0].id } }), 1);
});

test("SlotBindingService queues the fourth active requirement without binding main", async () => {
  const { project, requirements } = await createProjectWithRequirements(4);
  const service = new SlotBindingService(prisma);

  for (const requirement of requirements.slice(0, 3)) {
    const bound = await service.bindRequirement({
      projectId: project.id,
      requirementId: requirement.id
    });
    assert.match(bound.slotId, /^slot-[1-3]$/);
  }
  const overflow = await service.bindRequirement({
    projectId: project.id,
    requirementId: requirements[3].id
  });

  assert.equal(overflow, null);
  assert.equal(await prisma.slotBinding.count({ where: { projectId: project.id, slotId: "main" } }), 0);
  assert.equal(await prisma.slotBinding.count({ where: { projectId: project.id } }), 3);
});

test("SlotBindingService explicit release drains then idles and emits slot_released", async () => {
  const { project, requirements } = await createProjectWithRequirements(1);
  const service = new SlotBindingService(prisma);
  const bound = await service.bindRequirement({
    projectId: project.id,
    requirementId: requirements[0].id
  });

  const released = await service.releaseSlot({
    projectId: project.id,
    slotId: bound.slotId,
    reason: "manual_release",
    releasedBy: "user",
    operatorReason: "operator requested release"
  });

  assert.equal(released.state, "idle");
  assert.equal(released.requirementId, null);
  assert.equal(released.releasedAt instanceof Date, true);
  const event = await prisma.eventJournal.findFirstOrThrow({ where: { eventType: "slot_released" } });
  assert.equal(JSON.parse(event.payloadJson).operatorReason, "operator requested release");
});

test("SlotBindingService keeps release authoritative when the release callback fails", async () => {
  const { project, requirements } = await createProjectWithRequirements(1);
  const service = new SlotBindingService(prisma, {
    onSlotReleased: async () => {
      throw new Error("tips sync failed");
    }
  });
  const bound = await service.bindRequirement({
    projectId: project.id,
    requirementId: requirements[0].id
  });

  const released = await service.releaseSlot({
    projectId: project.id,
    slotId: bound.slotId,
    reason: "manual_release",
    releasedBy: "user"
  });

  assert.equal(released.state, "idle");
  assert.equal(released.requirementId, null);
  assert.equal(await prisma.eventJournal.count({ where: { eventType: "slot_released" } }), 1);
});

test("SlotBindingService release callback drains the oldest queued requirement into the freed slot", async () => {
  const { project, requirements } = await createProjectWithRequirements(4);
  let router!: JobSlotRouter;
  const service = new SlotBindingService(prisma, {
    onSlotReleased: async ({ projectId }) => {
      await router.tick(projectId);
    }
  });
  router = new JobSlotRouter({ prismaClient: prisma, slotBinding: service });

  for (const requirement of requirements.slice(0, 3)) {
    await service.bindRequirement({ projectId: project.id, requirementId: requirement.id });
  }
  const queued = await router.enqueue({
    projectId: project.id,
    requirementId: requirements[3].id,
    subjectType: "requirement",
    subjectId: requirements[3].id,
    command: "/ccb:su-flow --payload {}"
  });

  await service.releaseSlot({
    projectId: project.id,
    slotId: "slot-1",
    reason: "requirement_archived",
    releasedBy: "system"
  });

  const row = await prisma.anchorDispatchQueue.findUniqueOrThrow({ where: { jobId: queued.jobId } });
  assert.equal(row.anchorId, "slot-1");
  assert.equal(row.status, "pending");
  const rebound = await prisma.slotBinding.findUniqueOrThrow({
    where: {
      projectId_slotId: {
        projectId: project.id,
        slotId: "slot-1"
      }
    }
  });
  assert.equal(rebound.requirementId, requirements[3].id);
  assert.equal(rebound.state, "bound");
  assert.equal(await prisma.eventJournal.count({ where: { eventType: "slot_queued_request" } }), 1);
});
