import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import { preTaskCreateHookPayloadSchema } from "./hooks.schemas.js";
import { triggerPreTaskCreateHook } from "./hooks.service.js";

export async function registerHookRoutes(routes: FastifyInstance): Promise<void> {
  routes.post("/api/hooks/pre-task-create", async (request, reply) => {
    const parsed = preTaskCreateHookPayloadSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "hook payload 参数不合法",
        issues: parsed.error.issues
      };
    }

    return triggerPreTaskCreateHook(prisma, parsed.data);
  });
}
