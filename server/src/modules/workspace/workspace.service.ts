import { join } from "node:path";

import type { PrismaClient, TaskWorkspace } from "@prisma/client";

import {
  GitWorktreeError,
  addWorktree,
  assertGitRepository,
  prepareWorktreeRoot,
  removeWorktree
} from "../../fs/git-worktree.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";

const ACTIVE_WORKSPACE_STATUSES = ["creating", "ready", "in_use"];

export class WorkspaceConflictError extends Error {
  constructor() {
    super("当前任务已有 active workspace");
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super("任务工作空间不存在");
  }
}

export class TaskNotFoundError extends Error {
  constructor() {
    super("任务不存在");
  }
}

export async function listTaskWorkspaces(prisma: PrismaClient, taskId: string): Promise<TaskWorkspace[]> {
  return await prisma.taskWorkspace.findMany({
    where: {
      taskId
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function createTaskWorkspace(
  prisma: PrismaClient,
  taskId: string,
  input: {
    baseRef: string;
    branchName?: string;
    lockMode: string;
    cleanupPolicy: string;
  }
): Promise<{ workspace: TaskWorkspace; statusCode: 201 | 400 }> {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId
    },
    include: {
      project: true
    }
  });

  if (!task) {
    throw new TaskNotFoundError();
  }

  const activeWorkspace = await prisma.taskWorkspace.findFirst({
    where: {
      taskId,
      status: {
        in: ACTIVE_WORKSPACE_STATUSES
      }
    }
  });

  if (activeWorkspace) {
    throw new WorkspaceConflictError();
  }

  const branchName = input.branchName ?? `task/${task.taskKey}`;
  const workspacePath = join(task.project.localPath, ".workspaces", task.taskKey);

  const workspace = await primitiveExecutor.run({
    primitive: "apply_task_workspace_state",
    mutationType: "prisma.taskWorkspace.create/update",
    idempotencyKey: `${task.id}:apply_task_workspace_state:create:${branchName}`,
    run: async () =>
      await prisma.taskWorkspace.create({
        data: {
          projectId: task.projectId,
          taskId: task.id,
          taskKey: task.taskKey,
          baseRef: input.baseRef,
          branchName,
          workspacePath: workspacePath.replace(/\\/g, "/"),
          status: "creating",
          lockMode: input.lockMode,
          cleanupPolicy: input.cleanupPolicy
        }
      })
  });

  try {
    assertGitRepository(task.project.localPath);
    await prepareWorktreeRoot(task.project.localPath);
    await addWorktree({
      cwd: task.project.localPath,
      workspacePath,
      branchName,
      baseRef: input.baseRef
    });

    return {
      statusCode: 201,
      workspace: await primitiveExecutor.run({
        primitive: "apply_task_workspace_state",
        mutationType: "prisma.taskWorkspace.create/update",
        idempotencyKey: `${workspace.id}:apply_task_workspace_state:ready`,
        run: async () =>
          await prisma.taskWorkspace.update({
            where: {
              id: workspace.id
            },
            data: {
              status: "ready",
              errorMessage: null,
              lastVerifiedAt: new Date()
            }
          })
      })
    };
  } catch (error) {
    const message = error instanceof GitWorktreeError || error instanceof Error ? error.message : "创建 worktree 失败";
    return {
      statusCode: 400,
      workspace: await primitiveExecutor.run({
        primitive: "apply_task_workspace_state",
        mutationType: "prisma.taskWorkspace.create/update",
        idempotencyKey: `${workspace.id}:apply_task_workspace_state:error`,
        run: async () =>
          await prisma.taskWorkspace.update({
            where: {
              id: workspace.id
            },
            data: {
              status: "error",
              errorMessage: message
            }
          })
      })
    };
  }
}

export async function cleanupTaskWorkspace(prisma: PrismaClient, workspaceId: string): Promise<TaskWorkspace> {
  const workspace = await prisma.taskWorkspace.findUnique({
    where: {
      id: workspaceId
    },
    include: {
      project: true
    }
  });

  if (!workspace) {
    throw new WorkspaceNotFoundError();
  }

  if (workspace.status === "cleaned") {
    return workspace;
  }

  await primitiveExecutor.run({
    primitive: "cleanup_task_workspace",
    mutationType: "prisma.taskWorkspace.update",
    idempotencyKey: `${workspace.id}:cleanup_task_workspace:pending`,
    run: async () =>
      await prisma.taskWorkspace.update({
        where: {
          id: workspace.id
        },
        data: {
          status: "cleanup_pending"
        }
      })
  });

  try {
    await removeWorktree({
      cwd: workspace.project.localPath,
      workspacePath: workspace.workspacePath
    });

    return await primitiveExecutor.run({
      primitive: "cleanup_task_workspace",
      mutationType: "prisma.taskWorkspace.update",
      idempotencyKey: `${workspace.id}:cleanup_task_workspace:cleaned`,
      run: async () =>
        await prisma.taskWorkspace.update({
          where: {
            id: workspace.id
          },
          data: {
            status: "cleaned",
            errorMessage: null,
            lastVerifiedAt: new Date()
          }
        })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "清理 worktree 失败";
    return await primitiveExecutor.run({
      primitive: "cleanup_task_workspace",
      mutationType: "prisma.taskWorkspace.update",
      idempotencyKey: `${workspace.id}:cleanup_task_workspace:error`,
      run: async () =>
        await prisma.taskWorkspace.update({
          where: {
            id: workspace.id
          },
          data: {
            status: "error",
            errorMessage: message
          }
      })
    });
  }
}
