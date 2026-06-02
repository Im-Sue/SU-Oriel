import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";

test("retired drift and transition-consumption endpoints are not registered", async () => {
  const project = await prisma.project.create({
    data: {
      name: `phase4b-retired-${randomUUID()}`,
      localPath: `/tmp/phase4b-retired-${randomUUID()}`
    }
  });
  const app = buildApp({ enableFileWatcher: false });

  try {
    const drift = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/drift-tasks`
    });
    const transition = await app.inject({
      method: "POST",
      url: `/api/event-journal/events/${randomUUID()}/transition-consumption-attempts`,
      payload: {}
    });

    assert.equal(drift.statusCode, 404);
    assert.equal(transition.statusCode, 404);
  } finally {
    await app.close();
    await prisma.project.deleteMany({ where: { id: project.id } });
  }
});
