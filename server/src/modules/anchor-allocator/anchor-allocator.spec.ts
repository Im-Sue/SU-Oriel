import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, test } from "vitest";

import { prisma } from "../../db/prisma.js";
import { AnchorAllocatorService } from "./anchor-allocator.service.js";

async function resetFixtures(): Promise<void> {
  await prisma.anchorAllocation.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.project.deleteMany();
}

async function createRequirementFixture(index = 0) {
  const suffix = `${index}-${randomUUID()}`;
  const project = await prisma.project.create({
    data: {
      name: `anchor-allocator-${suffix}`,
      localPath: join(tmpdir(), `ccb-anchor-allocator-${suffix}`)
    }
  });
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      title: `Anchor allocator requirement ${suffix}`,
      description: "Requirement planning carrier",
      status: "planning"
    }
  });
  return { project, requirement };
}

beforeEach(async () => {
  await resetFixtures();
});

test("acquireAnchor allows only one allocation under 100 concurrent attempts for the same requirement", async () => {
  const { project, requirement } = await createRequirementFixture();
  const service = new AnchorAllocatorService(prisma);

  const results = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      service.acquireAnchor({
        projectId: project.id,
        subjectType: "requirement",
        subjectId: requirement.id,
        subjectKey: requirement.title,
        mode: "planning",
        anchorPath: join(project.localPath, `../repo-task-${index}`)
      })
    )
  );

  const acquired = results.filter((anchor) => anchor !== null);
  assert.equal(acquired.length, 1);
  assert.equal(await prisma.anchorAllocation.count({ where: { subjectType: "requirement", subjectId: requirement.id, mode: "planning" } }), 1);
});

test("acquireAnchor enforces WIP=10 and returns null for the eleventh active requirement", async () => {
  const service = new AnchorAllocatorService(prisma);
  const fixtures = await Promise.all(Array.from({ length: 11 }, (_, index) => createRequirementFixture(index)));

  for (const [index, fixture] of fixtures.slice(0, 10).entries()) {
    assert.ok(await service.acquireAnchor({
      projectId: fixture.project.id,
      subjectType: "requirement",
      subjectId: fixture.requirement.id,
      subjectKey: fixture.requirement.title,
      mode: "planning",
      anchorPath: join(fixture.project.localPath, `../repo-task-${index + 1}`)
    }));
  }

  assert.equal(
    await service.acquireAnchor({
      projectId: fixtures[10].project.id,
      subjectType: "requirement",
      subjectId: fixtures[10].requirement.id,
      subjectKey: fixtures[10].requirement.title,
      mode: "planning",
      anchorPath: join(fixtures[10].project.localPath, "../repo-task-11")
    }),
    null
  );
});

test("rollbackAnchor deletes a failed allocation and frees WIP capacity", async () => {
  const service = new AnchorAllocatorService(prisma);
  const first = await createRequirementFixture(1);
  const second = await createRequirementFixture(2);

  const allocated = await service.acquireAnchor({
    projectId: first.project.id,
    subjectType: "requirement",
    subjectId: first.requirement.id,
    subjectKey: first.requirement.title,
    mode: "planning",
    anchorPath: join(first.project.localPath, "../repo-task-rollback")
  });
  assert.ok(allocated);

  await service.rollbackAnchor(allocated.anchorId);

  assert.equal(await prisma.anchorAllocation.count(), 0);
  assert.ok(await service.acquireAnchor({
    projectId: second.project.id,
    subjectType: "requirement",
    subjectId: second.requirement.id,
    subjectKey: second.requirement.title,
    mode: "planning",
    anchorPath: join(second.project.localPath, "../repo-task-after-rollback")
  }));
});

test("markRuntimePaused toggles runtime pause without changing lifecycle state", async () => {
  const service = new AnchorAllocatorService(prisma);
  const { project, requirement } = await createRequirementFixture();
  const allocated = await service.acquireAnchor({
    projectId: project.id,
    subjectType: "requirement",
    subjectId: requirement.id,
    subjectKey: requirement.title,
    mode: "planning",
    anchorPath: join(project.localPath, "../repo-task-runtime-pause")
  });
  assert.ok(allocated);
  const ready = await service.markReady(allocated.anchorId, "/tmp/anchor-runtime-ready.sock");

  const paused = await service.markRuntimePaused(ready.anchorId, true);

  assert.equal(paused.state, "ready");
  assert.equal(paused.runtimePaused, true);
  assert.equal(paused.socketPath, null);

  const resumed = await service.markRuntimePaused(ready.anchorId, false, "/tmp/anchor-runtime-resumed.sock");

  assert.equal(resumed.state, "ready");
  assert.equal(resumed.runtimePaused, false);
  assert.equal(resumed.socketPath, "/tmp/anchor-runtime-resumed.sock");
});
