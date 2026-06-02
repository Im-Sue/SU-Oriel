import type { FastifyInstance } from "fastify";

import {
  EventJournalProjectMismatchError,
  EventJournalTaskNotFoundError
} from "../events/event-journal.service.js";
import { codexReceiptBridgeSchema } from "./receipt.schemas.js";
import { ingestCodexReceipt } from "./receipt.service.js";

export async function registerCcbBridgeReceiptRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/ccb-bridge/receipt", async (request, reply) => {
    const parsed = codexReceiptBridgeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.status(400);
      return {
        message: "codex receipt bridge 参数不合法",
        issues: parsed.error.issues
      };
    }

    try {
      const result = await ingestCodexReceipt(parsed.data);
      if (result.result === "created") {
        reply.status(201);
      } else if (result.result === "dead_lettered") {
        reply.status(202);
      } else {
        reply.status(200);
      }
      return result;
    } catch (error) {
      if (error instanceof EventJournalTaskNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      if (error instanceof EventJournalProjectMismatchError) {
        reply.status(400);
        return {
          message: "codex receipt bridge project_id 与 task 不匹配"
        };
      }
      throw error;
    }
  });
}
