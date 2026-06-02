import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, test, vi } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";

const execFileAsync = promisify(execFile);

async function resetDatabase(): Promise<void> {
  await prisma.taskRun.deleteMany(); await prisma.eventJournal.deleteMany();
  await prisma.reviewIntent.deleteMany();
  await prisma.taskWorkspace.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.task.deleteMany();
  await prisma.document.deleteMany();
  await prisma.project.deleteMany();
}

async function initGitRepository(projectRoot: string): Promise<void> {
  await mkdir(projectRoot, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: projectRoot });
  await execFileAsync("git", ["config", "user.email", "taskrun@example.test"], { cwd: projectRoot });
  await execFileAsync("git", ["config", "user.name", "TaskRun Test"], { cwd: projectRoot });
  await writeFile(join(projectRoot, "README.md"), "# TaskRun route fixture\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: projectRoot });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: projectRoot });
}

async function createTaskFixture(): Promise<{
  projectId: string;
  projectRoot: string;
  taskId: string;
  taskKey: string;
}> {
  const projectRoot = join(tmpdir(), `ccb-task-run-routes-${randomUUID()}`);
  await initGitRepository(projectRoot);
  const project = await prisma.project.create({
    data: {
      name: `TaskRun Route Project ${randomUUID()}`,
      localPath: projectRoot,
      updatedAt: new Date()
    }
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${randomUUID()}`,
      title: "TaskRun route task",
      status: "reviewing",
      currentNode: "dispatch",
      nodeSubstate: "ready_for_dispatch",
      runtimeState: "running",
      updatedAt: new Date()
    }
  });

  return {
    projectId: project.id,
    projectRoot,
    taskId: task.id,
    taskKey: task.taskKey
  };
}

test("POST /api/task-runs/:taskId/dispatch returns 410 after Console worktree dispatch retirement", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/dispatch`,
      payload: {
        attempt_n: 1
      }
    });

    assert.equal(response.statusCode, 410, response.body);
    assert.match(response.json().message, /worktree 入口已关闭/);
    assert.equal(
      await prisma.taskRun.count({
        where: {
          taskId: fixture.taskId
        }
      }),
      0
    );
  } finally {
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/dispatch stays retired even when the main repo is dirty", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  await writeFile(join(fixture.projectRoot, "DIRTY.md"), "dirty\n", "utf8");

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/dispatch`,
      payload: {
        attempt_n: 1
      }
    });

    assert.equal(response.statusCode, 410, response.body);
    assert.match(response.json().message, /worktree 入口已关闭/);
    assert.equal(
      await prisma.taskRun.count({
        where: {
          taskId: fixture.taskId
        }
      }),
      0
    );
  } finally {
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/dispatch rejects force=true after Console worktree dispatch retirement", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  await writeFile(join(fixture.projectRoot, "DIRTY.md"), "dirty\n", "utf8");

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/dispatch?force=true`,
      payload: {
        attempt_n: 1
      }
    });

    assert.equal(response.statusCode, 410, response.body);
    assert.match(response.json().message, /worktree 入口已关闭/);
  } finally {
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/dispatch rejects body force=true after Console worktree dispatch retirement", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  await writeFile(join(fixture.projectRoot, "DIRTY.md"), "dirty\n", "utf8");

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/dispatch`,
      payload: {
        attempt_n: 1,
        force: true
      }
    });

    assert.equal(response.statusCode, 410, response.body);
    assert.match(response.json().message, /worktree 入口已关闭/);
  } finally {
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/retry returns 410 because retry would create a worktree", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  await prisma.taskRun.create({
    data: {
      taskId: fixture.taskId,
      status: "failed",
      attemptN: 1,
      errorSummary: "worker failed",
      transitionsJson: JSON.stringify([{ from: "running", to: "failed", attempt_n: 1 }])
    }
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/retry`
    });

    assert.equal(response.statusCode, 410, response.body);
    assert.match(response.json().message, /worktree 入口已关闭/);

    const runs = await prisma.taskRun.findMany({
      where: {
        taskId: fixture.taskId
      },
      orderBy: {
        attemptN: "asc"
      }
    });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "failed");
  } finally {
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/dispatch returns 410 consistently for repeated attempts", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();

  try {
    const first = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/dispatch`,
      payload: {
        attempt_n: 1
      }
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/dispatch`,
      payload: {
        attempt_n: 1
      }
    });

    assert.equal(first.statusCode, 410, first.body);
    assert.equal(second.statusCode, 410, second.body);
    assert.match(first.json().message, /worktree 入口已关闭/);
    assert.match(second.json().message, /worktree 入口已关闭/);
    assert.equal(
      await prisma.taskRun.count({
        where: {
          taskId: fixture.taskId,
          attemptN: 1
        }
      }),
      0
    );
  } finally {
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/pause pauses the running TaskRun through K1", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  await prisma.taskRun.create({
    data: {
      taskId: fixture.taskId,
      status: "running",
      attemptN: 1,
      dispatchedAt: new Date("2026-05-03T00:00:00.000Z"),
      transitionsJson: JSON.stringify([{ from: "dispatched", to: "running", attempt_n: 1 }])
    }
  });
  const runSpy = vi.spyOn(primitiveExecutor, "run");

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/pause`
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().success, true);
    assert.equal(response.json().task_run.status, "paused");
    assert.equal(response.json().task_run.attempt_n, 1);
    assert.ok(runSpy.mock.calls.some(([input]) => input.primitive === "pause_task"));
  } finally {
    runSpy.mockRestore();
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/resume resumes the paused TaskRun through K1", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  await prisma.taskRun.create({
    data: {
      taskId: fixture.taskId,
      status: "paused",
      attemptN: 1,
      dispatchedAt: new Date("2026-05-03T00:00:00.000Z"),
      transitionsJson: JSON.stringify([{ from: "running", to: "paused", attempt_n: 1 }])
    }
  });
  const runSpy = vi.spyOn(primitiveExecutor, "run");

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/resume`
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().success, true);
    assert.equal(response.json().task_run.status, "running");
    assert.ok(runSpy.mock.calls.some(([input]) => input.primitive === "resume_task"));
  } finally {
    runSpy.mockRestore();
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/cancel cancels a non-terminal TaskRun through K1", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  await prisma.taskRun.create({
    data: {
      taskId: fixture.taskId,
      status: "dispatched",
      attemptN: 1,
      dispatchedAt: new Date("2026-05-03T00:00:00.000Z"),
      transitionsJson: JSON.stringify([{ from: "pending", to: "dispatched", attempt_n: 1 }])
    }
  });
  const runSpy = vi.spyOn(primitiveExecutor, "run");

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/cancel`
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().success, true);
    assert.equal(response.json().task_run.status, "cancelled");
    assert.ok(runSpy.mock.calls.some(([input]) => input.primitive === "cancel_task"));
  } finally {
    runSpy.mockRestore();
    await app.close();
  }
});

test("POST /api/task-runs/:taskId/pause rejects invalid paused to paused transition", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  await prisma.taskRun.create({
    data: {
      taskId: fixture.taskId,
      status: "paused",
      attemptN: 1,
      transitionsJson: JSON.stringify([{ from: "running", to: "paused", attempt_n: 1 }])
    }
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/task-runs/${fixture.taskId}/pause`
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.match(response.json().message, /paused -> paused/);
  } finally {
    await app.close();
  }
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});
