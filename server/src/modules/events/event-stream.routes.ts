import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import { resolveEventStreamCursor, streamTaskEvents } from "./event-stream.service.js";

function acceptsEventStream(accept: string | undefined): boolean {
  return Boolean(accept?.split(",").some((item) => item.trim().startsWith("text/event-stream")));
}

export async function registerEventStreamRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { taskId: string }; Querystring: { since?: string } }>(
    "/api/tasks/:taskId/events",
    async (request, reply) => {
      const { taskId } = request.params;
      if (!acceptsEventStream(request.headers.accept)) {
        reply.status(406);
        return { message: "SSE endpoint requires Accept: text/event-stream" };
      }
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
      if (!task) {
        reply.status(404);
        return { message: "任务不存在" };
      }
      const lastEventId = request.headers["last-event-id"];
      const requestedEventId = (Array.isArray(lastEventId) ? lastEventId[0] : lastEventId) ?? request.query.since;
      const abortController = new AbortController();
      request.raw.on("close", () => abortController.abort());
      const cursor = await resolveEventStreamCursor(taskId, requestedEventId);
      if (abortController.signal.aborted) return;
      if (!cursor.ok) {
        reply.status(410);
        return { error: "last_event_id_not_found", task_id: taskId, requested_event_id: requestedEventId };
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      const write = (chunk: string): boolean => !reply.raw.destroyed && reply.raw.write(chunk);
      const heartbeat = () => write(": heartbeat\n\n");
      heartbeat();
      await streamTaskEvents(
        taskId,
        requestedEventId,
        (event) => write(`id: ${event.event_id}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`),
        (error) => app.log.error({ err: error }, "SSE event stream failed"),
        () => {
          if (!reply.raw.destroyed) reply.raw.end();
        },
        {
          logger: app.log,
          onHeartbeat: heartbeat,
          initialCursor: cursor.cursor,
          abortSignal: abortController.signal,
          onProjectionSignal: (signal) => write(`event: projection\ndata: ${JSON.stringify(signal)}\n\n`)
        }
      );
    }
  );
}
