import type { FastifyInstance } from "fastify";

import { getTaskNodeFlow, TaskNodeFlowNotFoundError } from "./task-node-flow.service.js";
import { taskNodeFlowParamsSchema } from "./task-node-flow.schemas.js";

export async function registerTaskNodeFlowRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tasks/:taskId/node-flow", async (request, reply) => {
    const parsedParams = taskNodeFlowParamsSchema.safeParse(request.params ?? {});

    if (!parsedParams.success) {
      reply.status(400);
      return {
        message: "node-flow 参数不合法",
        issues: parsedParams.error.issues
      };
    }

    try {
      return await getTaskNodeFlow(parsedParams.data.taskId);
    } catch (error) {
      if (error instanceof TaskNodeFlowNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      throw error;
    }
  });
}
