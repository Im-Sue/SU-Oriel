import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";

const ACTIVE_NODE_IDS = new Set(["requirement_analysis", "technical_design", "task_breakdown", "dispatch", "implementation", "review"]);

export interface AnchorStarterLike {
  startEpicAnchor(epicId: string): Promise<unknown>;
}

export interface StartAiSessionRouteDependencies {
  prismaClient?: PrismaClient;
  anchorStarter?: AnchorStarterLike;
}

export async function registerStartAiSessionRoutes(
  app: FastifyInstance,
  dependencies: StartAiSessionRouteDependencies = {}
): Promise<void> {
  const db = dependencies.prismaClient ?? prisma;
  void dependencies.anchorStarter;

  app.post("/api/tasks/:taskId/start-ai-session", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = await db.task.findUnique({
      where: {
        id: taskId
      },
      select: {
        id: true,
        taskKey: true,
        title: true,
        status: true,
        currentNode: true,
        project: {
          select: {
            localPath: true
          }
        }
      }
    });

    if (!task) {
      reply.status(404);
      return { message: "任务不存在" };
    }
    if (task.status !== "reviewing" || !task.currentNode || !ACTIVE_NODE_IDS.has(task.currentNode)) {
      reply.status(400);
      return { message: "任务当前状态不允许启动 AI session" };
    }

    reply.status(410);
    return {
      message: "旧 AI task slot 启动入口已由 Task Anchor Runtime 取代；请使用 /api/epics/:epicId/anchor/start"
    };
  });
}
