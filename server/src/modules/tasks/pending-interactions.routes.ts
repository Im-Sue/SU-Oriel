import type { FastifyInstance } from "fastify";

import { listPendingInteractions, PendingInteractionsTaskNotFoundError } from "./pending-interactions.service.js";

export async function registerPendingInteractionsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tasks/:taskId/pending-interactions", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    try {
      return await listPendingInteractions(taskId);
    } catch (error) {
      if (error instanceof PendingInteractionsTaskNotFoundError) {
        reply.status(404);
        return { message: error.message };
      }
      throw error;
    }
  });
}
