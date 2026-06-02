import type { FastifyInstance } from "fastify";
import type { TaskWorkspace } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import {
  listTaskWorkspaces
} from "./workspace.service.js";

const CONSOLE_WORKSPACE_WRITE_DISABLED_MESSAGE =
  "Console 任务工作区建删入口已关闭；per-需求 worktree 由 CCB plugin 生命周期管理";

export function serializeWorkspace(workspace: TaskWorkspace) {
  return {
    id: workspace.id,
    projectId: workspace.projectId,
    taskId: workspace.taskId,
    taskKey: workspace.taskKey,
    baseRef: workspace.baseRef,
    branchName: workspace.branchName,
    workspacePath: workspace.workspacePath,
    status: workspace.status,
    lockMode: workspace.lockMode,
    cleanupPolicy: workspace.cleanupPolicy,
    lockedByRunId: workspace.lockedByRunId,
    cleanupAfter: workspace.cleanupAfter?.toISOString() ?? null,
    lastVerifiedAt: workspace.lastVerifiedAt?.toISOString() ?? null,
    errorMessage: workspace.errorMessage,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString()
  };
}

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tasks/:taskId/workspaces", async (request) => {
    const { taskId } = request.params as { taskId: string };
    const workspaces = await listTaskWorkspaces(prisma, taskId);

    return {
      items: workspaces.map((workspace) => serializeWorkspace(workspace))
    };
  });

  app.post("/api/tasks/:taskId/workspaces", async (request, reply) => {
    void request;
    reply.status(410);
    return {
      message: CONSOLE_WORKSPACE_WRITE_DISABLED_MESSAGE
    };
  });

  app.delete("/api/task-workspaces/:workspaceId", async (request, reply) => {
    void request;
    reply.status(410);
    return {
      message: CONSOLE_WORKSPACE_WRITE_DISABLED_MESSAGE
    };
  });
}
