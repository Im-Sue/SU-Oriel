import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";

async function resetDatabase(): Promise<void> {
  await prisma.anchorAllocation.deleteMany();
  await prisma.slotBinding.deleteMany();
  await prisma.task.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.project.deleteMany();
}

beforeEach(async () => {
  await resetDatabase();
});

test("buildApp no longer runs legacy AnchorAllocation recovery on startup", async () => {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `startup-recovery-${suffix}`,
      localPath: join(tmpdir(), `ccb-startup-recovery-${suffix}`)
    }
  });
  await prisma.anchorAllocation.create({
    data: {
      anchorId: "legacy-startup-anchor",
      anchorPath: join(project.localPath, "legacy-startup-anchor"),
      projectId: project.id,
      socketPath: join(project.localPath, "missing.sock"),
      subjectType: "requirement",
      subjectId: "legacy-requirement",
      subjectKey: "Legacy Requirement",
      mode: "planning",
      state: "ready",
      heartbeatAt: null
    }
  });

  const app = buildApp({
    enableFileWatcher: false,
    startupProjectScan: null
  });

  try {
    await app.ready();
    const row = await prisma.anchorAllocation.findUniqueOrThrow({
      where: { anchorId: "legacy-startup-anchor" }
    });
    assert.equal(row.state, "ready");
    assert.equal(row.heartbeatAt, null);
  } finally {
    await app.close();
  }
});
