import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";

const createdProjectIds: string[] = [];

async function createProjectFixture() {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `ai-tools-${suffix}`,
      localPath: join(tmpdir(), `ccb-ai-tools-${suffix}`)
    }
  });
  createdProjectIds.push(project.id);
  return project;
}

async function createTaskFixture(
  overrides: Partial<{
    projectId: string;
    taskKey: string;
    title: string;
    status: string;
    currentNode: string | null;
    runtimeState: string | null;
    progress: number;
    requirementId: string | null;
  }> = {}
) {
  const projectId = overrides.projectId ?? (await createProjectFixture()).id;
  const suffix = randomUUID();
  return await prisma.task.create({
    data: {
      projectId,
      taskKey: overrides.taskKey ?? `task-${suffix}`,
      title: overrides.title ?? "AI tool task",
      status: overrides.status ?? "active",
      currentNode: overrides.currentNode === undefined ? "implementation" : overrides.currentNode,
      runtimeState: overrides.runtimeState === undefined ? "running" : overrides.runtimeState,
      progress: overrides.progress ?? 40,
      requirementId: overrides.requirementId ?? null
    }
  });
}

async function createDocument(projectId: string, taskKey: string, kind: "dev_task" | "state", path: string) {
  return await prisma.document.create({
    data: {
      projectId,
      taskKey,
      path,
      kind,
      title: `${kind} ${taskKey}`,
      status: kind === "dev_task" ? "reviewing" : null,
      frontmatterJson: JSON.stringify({ task_key: taskKey, currentNode: "implementation" }),
      contentHash: randomUUID(),
      mtime: new Date()
    }
  });
}

afterEach(async () => {
  await prisma.anchorDispatchQueue.deleteMany();
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.project.deleteMany({
      where: { id: projectId }
    });
  }
});

test("GET /api/ai-tools/registry omits retired status-repair write tool", async () => {
  const app = buildApp({ enableFileWatcher: false });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/ai-tools/registry"
    });

    assert.equal(response.statusCode, 200, response.body);
    const tools = response.json().tools as Array<{ name: string; input_schema: { type: string }; writes: boolean }>;
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["derive_followup", "fetch_task_state"].sort()
    );
    assert.ok(tools.every((tool) => tool.input_schema.type === "object"));
    assert.equal(tools.find((tool) => tool.name === "fetch_task_state")?.writes, false);
  } finally {
    await app.close();
  }
});

test("POST /api/ai-tools/invoke repair_task_status is retired", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const task = await createTaskFixture();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-tools/invoke",
      payload: {
        tool_name: "repair_task_status",
        actor: "ai:claude",
        input: {
          taskId: task.id,
          type: "set_progress",
          payload: { progress: 88 },
          reason: "AI tool smoke"
        }
      }
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error.type, "unknown_tool");
    assert.equal(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }).then((row) => row.progress), 40);
  } finally {
    await app.close();
  }
});

test("POST /api/ai-tools/invoke derive_followup queues requirement task_breakdown dispatch", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const project = await createProjectFixture();
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      title: "AI tool source requirement",
      description: "source req",
      status: "delivering"
    }
  });
  const task = await createTaskFixture({ projectId: project.id, requirementId: requirement.id });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-tools/invoke",
      payload: {
        tool_name: "derive_followup",
        input: {
          sourceTaskId: task.id,
          type: "requirement",
          title: "Followup requirement",
          description: "derived from implementation"
        }
      }
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().result.kind, "dispatch");
    assert.equal(response.json().result.dispatch.requirementId, requirement.id);
    assert.equal(response.json().result.dispatch.sourceTaskId, task.id);
    assert.equal(response.json().result.dispatch.followupType, "requirement");
  } finally {
    await app.close();
  }
});

test("POST /api/ai-tools/invoke fetch_task_state returns task with dev_task doc", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const project = await createProjectFixture();
  const task = await createTaskFixture({ projectId: project.id });
  await createDocument(project.id, task.taskKey, "dev_task", `docs/03_开发计划/${task.taskKey}.md`);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-tools/invoke",
      payload: {
        tool_name: "fetch_task_state",
        input: {
          taskId: task.id
        }
      }
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().result.task.id, task.id);
    assert.equal(response.json().result.documents.dev_task.path, `docs/03_开发计划/${task.taskKey}.md`);
  } finally {
    await app.close();
  }
});

test("POST /api/ai-tools/invoke returns structured errors for unknown tool and invalid input", async () => {
  const app = buildApp({ enableFileWatcher: false });

  try {
    const unknown = await app.inject({
      method: "POST",
      url: "/api/ai-tools/invoke",
      payload: {
        tool_name: "missing_tool",
        input: {}
      }
    });
    assert.equal(unknown.statusCode, 400, unknown.body);
    assert.equal(unknown.json().error.type, "unknown_tool");
    assert.equal(unknown.json().error.retry_suggested, false);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/ai-tools/invoke",
      payload: {
        tool_name: "fetch_task_state",
        input: {}
      }
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error.type, "invalid_input");
    assert.equal(invalid.json().error.retry_suggested, false);
  } finally {
    await app.close();
  }
});
