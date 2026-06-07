import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import {
  isSlotResizeLockTimeoutError,
  slotResizeLockTimeoutBody
} from "../slot-resize/resize-lock.js";
import { deriveTaskSchema } from "./derive.schemas.js";
import { DeriveTaskError, deriveFromTask } from "./derive.service.js";

export async function registerDeriveRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/tasks/:taskId/derive", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const parsed = deriveTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: "衍生参数不合法",
        issues: parsed.error.issues
      };
    }

    try {
      const result = await deriveFromTask(prisma, taskId, parsed.data);
      reply.status(202);
      return result;
    } catch (error) {
      if (error instanceof DeriveTaskError) {
        reply.status(error.statusCode);
        return {
          message: error.message
        };
      }
      if (isSlotResizeLockTimeoutError(error)) {
        reply.status(error.statusCode);
        return slotResizeLockTimeoutBody(error);
      }
      throw error;
    }
  });
}
