import type { FastifyInstance } from "fastify";

import { CheckpointTaskNotFoundError, getCheckpoint, listCheckpoints } from "./checkpoints.service.js";

export async function registerCheckpointsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tasks/:taskId/checkpoints", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    try {
      return await listCheckpoints(taskId);
    } catch (error) {
      if (error instanceof CheckpointTaskNotFoundError) {
        reply.status(404);
        return { message: error.message };
      }
      throw error;
    }
  });

  app.get("/api/tasks/:taskId/checkpoints/:transitionId", async (request, reply) => {
    const { taskId, transitionId } = request.params as { taskId: string; transitionId: string };
    try {
      const checkpoint = await getCheckpoint(taskId, transitionId);
      if (!checkpoint) {
        reply.status(404);
        return { message: "checkpoint 不存在" };
      }
      return checkpoint;
    } catch (error) {
      if (error instanceof CheckpointTaskNotFoundError) {
        reply.status(404);
        return { message: error.message };
      }
      throw error;
    }
  });
}
