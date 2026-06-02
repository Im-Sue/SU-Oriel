import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import {
  AiToolInvokeError,
  invokeAiTool,
  listAiTools,
  parseAiToolInvokeRequest
} from "./tool-invoke.service.js";

export async function registerAiToolsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/ai-tools/registry", async () => {
    return listAiTools();
  });

  app.post("/api/ai-tools/invoke", async (request, reply) => {
    try {
      const parsed = parseAiToolInvokeRequest(request.body ?? {});
      return await invokeAiTool(prisma, parsed);
    } catch (error) {
      if (error instanceof AiToolInvokeError) {
        reply.status(error.statusCode);
        return error.toResponse();
      }
      throw error;
    }
  });
}
