import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import { TaskEventViewService, type TaskEventViewServiceLike } from "./task-event-view.service.js";

export interface TaskEventViewRouteDependencies {
  prismaClient?: PrismaClient;
  service?: TaskEventViewServiceLike;
}

export async function registerTaskEventViewRoutes(
  app: FastifyInstance,
  dependencies: TaskEventViewRouteDependencies = {}
): Promise<void> {
  const db = dependencies.prismaClient ?? prisma;
  const service = dependencies.service ?? new TaskEventViewService(db);

  app.get("/api/tasks/:taskId/event-view", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      reply.status(404);
      return { message: "任务不存在" };
    }

    return await service.buildTimeline(taskId);
  });
}
