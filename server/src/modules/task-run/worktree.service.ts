import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { prisma } from "../../db/prisma.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";

const execFileAsync = promisify(execFile);

// 7 day TTL for stale TaskRun worktrees that never reached a terminal cleanup path.
export const TASK_RUN_WORKTREE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TaskRunWorktree = {
  workspacePath: string;
  worktreeBranch: string;
};

export type CleanupWorktreeResult = {
  status: "cleaned" | "skipped" | "cleanup_pending";
  workspacePath: string | null;
  worktreeBranch: string | null;
  diskUsage: string | null;
};

type CleanupWorktreeOptions = {
  force?: boolean;
  now?: Date;
};

const TERMINAL_TASK_RUN_STATUSES = new Set(["completed", "cancelled", "failed-terminal"]);

function buildWorktreePath(projectRoot: string, taskId: string, attemptN: number): string {
  return join(projectRoot, ".taskruns", taskId, String(attemptN));
}

function buildWorktreeBranch(taskId: string, attemptN: number): string {
  return `taskrun/${taskId}-attempt-${attemptN}`;
}

export function isWorktreeExpired(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > TASK_RUN_WORKTREE_TTL_MS;
}

async function runGit(projectRoot: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  // git worktree add is invoked via execFile args.
  // git worktree remove is invoked via execFile args.
  // git branch -D is invoked via execFile args.
  return await execFileAsync("git", ["-C", projectRoot, ...args]);
}

export async function getTaskRunWorktreeDiskUsage(projectRoot: string): Promise<string | null> {
  const taskRunsRoot = join(projectRoot, ".taskruns");
  if (!existsSync(taskRunsRoot)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("du", ["-sh", taskRunsRoot]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function createWorktree(taskId: string, attemptN: number): Promise<TaskRunWorktree> {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId
    },
    select: {
      id: true,
      project: {
        select: {
          localPath: true
        }
      }
    }
  });

  if (!task) {
    throw new Error("任务不存在");
  }

  const workspacePath = buildWorktreePath(task.project.localPath, task.id, attemptN);
  const worktreeBranch = buildWorktreeBranch(task.id, attemptN);

  await mkdir(dirname(workspacePath), { recursive: true });

  if (!existsSync(workspacePath)) {
    await runGit(task.project.localPath, ["worktree", "add", "-b", worktreeBranch, workspacePath, "HEAD"]);
  }

  return {
    workspacePath,
    worktreeBranch
  };
}

async function markCleanupPending(
  taskRun: { id: string; errorSummary: string | null },
  reason: unknown
): Promise<void> {
  const message = reason instanceof Error ? reason.message : String(reason);
  const prefix = taskRun.errorSummary ? `${taskRun.errorSummary}\n` : "";
  await primitiveExecutor.run({
    primitive: "cleanup_taskrun_worktree",
    mutationType: "prisma.taskRun.update",
    idempotencyKey: `${taskRun.id}:cleanup_taskrun_worktree:pending`,
    run: async () =>
      await prisma.taskRun.update({
        where: {
          id: taskRun.id
        },
        data: {
          errorSummary: `${prefix}cleanup_pending: ${message}`
        }
      })
  });
}

export async function cleanupWorktree(
  taskRunId: string,
  options: CleanupWorktreeOptions = {}
): Promise<CleanupWorktreeResult> {
  const taskRun = await prisma.taskRun.findUnique({
    where: {
      id: taskRunId
    },
    include: {
      task: {
        select: {
          project: {
            select: {
              localPath: true
            }
          }
        }
      }
    }
  });

  if (!taskRun || !taskRun.workspacePath || !taskRun.worktreeBranch) {
    return {
      status: "skipped",
      workspacePath: null,
      worktreeBranch: null,
      diskUsage: null
    };
  }

  const expired = isWorktreeExpired(taskRun.createdAt, options.now);
  if (!options.force && !expired && !TERMINAL_TASK_RUN_STATUSES.has(taskRun.status)) {
    return {
      status: "skipped",
      workspacePath: taskRun.workspacePath,
      worktreeBranch: taskRun.worktreeBranch,
      diskUsage: await getTaskRunWorktreeDiskUsage(taskRun.task.project.localPath)
    };
  }

  try {
    if (existsSync(taskRun.workspacePath)) {
      await runGit(taskRun.task.project.localPath, ["worktree", "remove", "--force", taskRun.workspacePath]);
    }
    await runGit(taskRun.task.project.localPath, ["branch", "-D", taskRun.worktreeBranch]).catch(() => ({
      stdout: "",
      stderr: ""
    }));

    await primitiveExecutor.run({
      primitive: "cleanup_taskrun_worktree",
      mutationType: "prisma.taskRun.update",
      idempotencyKey: `${taskRun.id}:cleanup_taskrun_worktree:cleaned`,
      run: async () =>
        await prisma.taskRun.update({
          where: {
            id: taskRun.id
          },
          data: {
            workspacePath: null,
            worktreeBranch: null
          }
        })
    });

    return {
      status: "cleaned",
      workspacePath: taskRun.workspacePath,
      worktreeBranch: taskRun.worktreeBranch,
      diskUsage: await getTaskRunWorktreeDiskUsage(taskRun.task.project.localPath)
    };
  } catch (error) {
    await markCleanupPending(taskRun, error);
    return {
      status: "cleanup_pending",
      workspacePath: taskRun.workspacePath,
      worktreeBranch: taskRun.worktreeBranch,
      diskUsage: await getTaskRunWorktreeDiskUsage(taskRun.task.project.localPath)
    };
  }
}
