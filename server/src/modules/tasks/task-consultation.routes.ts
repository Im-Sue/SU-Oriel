import type { FastifyInstance } from "fastify";

import { taskConsultationParamsSchema } from "./task-consultation.schemas.js";
import { getTaskConsultation, TaskConsultationNotFoundError } from "./task-consultation.service.js";

export async function registerTaskConsultationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tasks/:taskId/consultation", async (request, reply) => {
    const parsedParams = taskConsultationParamsSchema.safeParse(request.params ?? {});

    if (!parsedParams.success) {
      reply.status(400);
      return {
        message: "consultation 参数不合法",
        issues: parsedParams.error.issues
      };
    }

    try {
      return await getTaskConsultation(parsedParams.data.taskId);
    } catch (error) {
      if (error instanceof TaskConsultationNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      throw error;
    }
  });
}
