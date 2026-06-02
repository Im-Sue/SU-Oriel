import type { FastifyInstance } from "fastify";

import { emitEventSchema, listEventJournalQuerySchema } from "./event-journal.schemas.js";
import {
  emitEvent,
  EventJournalProjectMismatchError,
  EventJournalTaskNotFoundError,
  listEventJournal
} from "./event-journal.service.js";

export async function registerEventJournalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/event-journal/events", async (request, reply) => {
    const parsed = emitEventSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "event journal 参数不合法",
        issues: parsed.error.issues
      };
    }

    try {
      const result = await emitEvent(parsed.data);
      reply.status(result.result === "created" ? 201 : 200);
      return result;
    } catch (error) {
      if (error instanceof EventJournalProjectMismatchError) {
        reply.status(400);
        return {
          message: "event journal 参数不合法"
        };
      }
      if (error instanceof EventJournalTaskNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      throw error;
    }
  });

  app.get("/api/event-journal/events", async (request, reply) => {
    const parsed = listEventJournalQuerySchema.safeParse(request.query ?? {});

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "event journal 查询参数不合法",
        issues: parsed.error.issues
      };
    }

    return await listEventJournal(parsed.data);
  });
}
