import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, test } from "vitest";

import { prisma } from "../../db/prisma.js";
import {
  cleanupWorktree,
  createWorktree,
  isWorktreeExpired
} from "./worktree.service.js";

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
  await writeFile(join(projectRoot, "README.md"), "# TaskRun worktree fixture\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: projectRoot });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: projectRoot });
}

async function createTaskFixture(): Promise<{ projectRoot: string; taskId: string }> {
  const projectRoot = join(tmpdir(), `ccb-task-run-worktree-${randomUUID()}`);
  await initGitRepository(projectRoot);
  const project = await prisma.project.create({
    data: {
      name: `TaskRun Worktree Project ${randomUUID()}`,
      localPath: projectRoot,
      updatedAt: new Date()
    }
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${randomUUID()}`,
      title: "TaskRun worktree task",
      status: "reviewing",
      currentNode: "dispatch",
      nodeSubstate: "ready_for_dispatch",
      runtimeState: "running",
      updatedAt: new Date()
    }
  });

  return {
    projectRoot,
    taskId: task.id
  };
}

test("createWorktree creates .taskruns task attempt path and taskrun branch", async () => {
  await resetDatabase();
  const fixture = await createTaskFixture();

  const worktree = await createWorktree(fixture.taskId, 1);

  assert.equal(worktree.workspacePath, join(fixture.projectRoot, ".taskruns", fixture.taskId, "1"));
  assert.equal(worktree.worktreeBranch, `taskrun/${fixture.taskId}-attempt-1`);
  assert.equal(existsSync(worktree.workspacePath), true);
});

test("cleanupWorktree removes worktree and temporary branch", async () => {
  await resetDatabase();
  const fixture = await createTaskFixture();
  const worktree = await createWorktree(fixture.taskId, 1);
  const run = await prisma.taskRun.create({
    data: {
      taskId: fixture.taskId,
      status: "cancelled",
      attemptN: 1,
      workspacePath: worktree.workspacePath,
      worktreeBranch: worktree.worktreeBranch,
      transitionsJson: "[]"
    }
  });

  const result = await cleanupWorktree(run.id, { force: true });
  const branchList = await execFileAsync("git", ["branch", "--list", worktree.worktreeBranch], {
    cwd: fixture.projectRoot
  });
  const cleanedRun = await prisma.taskRun.findUniqueOrThrow({
    where: {
      id: run.id
    }
  });

  assert.equal(result.status, "cleaned");
  assert.equal(existsSync(worktree.workspacePath), false);
  assert.equal(branchList.stdout.trim(), "");
  assert.equal(cleanedRun.workspacePath, null);
  assert.equal(cleanedRun.worktreeBranch, null);
});

test("cleanupWorktree applies 7 day TTL for non-terminal worktrees", async () => {
  await resetDatabase();
  const fixture = await createTaskFixture();
  const worktree = await createWorktree(fixture.taskId, 2);
  const createdAt = new Date("2026-05-01T00:00:00.000Z");
  const run = await prisma.taskRun.create({
    data: {
      taskId: fixture.taskId,
      status: "running",
      attemptN: 2,
      workspacePath: worktree.workspacePath,
      worktreeBranch: worktree.worktreeBranch,
      transitionsJson: "[]",
      createdAt
    }
  });

  assert.equal(isWorktreeExpired(createdAt, new Date("2026-05-07T23:59:59.000Z")), false);
  assert.equal(isWorktreeExpired(createdAt, new Date("2026-05-08T00:00:01.000Z")), true);

  const result = await cleanupWorktree(run.id, { now: new Date("2026-05-08T00:00:01.000Z") });

  assert.equal(result.status, "cleaned");
  assert.equal(existsSync(worktree.workspacePath), false);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});
