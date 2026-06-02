import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { requireCcbToken } from "../../middleware/auth.js";
import {
  cancelConsultRequest,
  CONSULT_REQUEST_MESSAGE_LIMIT,
  ConsultRequestAgentNotAllowedError,
  ConsultRequestNodeMismatchError,
  ConsultRequestNotFoundError,
  ConsultRequestNotPendingError,
  ConsultRequestPendingExistsError,
  ConsultRequestTaskNotFoundError,
  ConsultRequestValidationError,
  getConsultRequest,
  serializeConsultRequest,
  submitConsultRequest
} from "./consult-requests.service.js";

const bodySchema = z.object({ message: z.string().trim().min(1).max(CONSULT_REQUEST_MESSAGE_LIMIT), target_agent: z.string().trim().min(1) }).strict();

function createRateLimiter(windowMs = 30000, limit = 5) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const now = Date.now(), current = hits.get(key);
    if (!current || current.resetAt <= now) { hits.set(key, { count: 1, resetAt: now + windowMs }); return true; }
    current.count += 1;
    return current.count <= limit;
  };
}

function mapConsultError(error: unknown, reply: FastifyReply): { error: string; code: string; hint?: string } | null {
  if (error instanceof ConsultRequestTaskNotFoundError || error instanceof ConsultRequestNotFoundError) { reply.status(404); return { error: error.message, code: "not_found" }; }
  if (error instanceof ConsultRequestNodeMismatchError || error instanceof ConsultRequestPendingExistsError || error instanceof ConsultRequestNotPendingError) {
    reply.status(409); return { error: error.message, code: "conflict" };
  }
  if (error instanceof ConsultRequestAgentNotAllowedError || error instanceof ConsultRequestValidationError) { reply.status(400); return { error: error.message, code: "bad_request" }; }
  return null;
}

export async function registerConsultRequestsRoutes(app: FastifyInstance): Promise<void> {
  const rateLimit = createRateLimiter();

  app.post("/api/tasks/:taskId/nodes/:nodeId/consult-requests", async (request, reply) => {
    if (!requireCcbToken(request, reply)) return reply;
    if (!rateLimit(request.ip)) {
      reply.status(429);
      return { error: "rate limit exceeded", code: "rate_limited", hint: "Retry after 30 seconds" };
    }
    const { taskId, nodeId } = request.params as { taskId: string; nodeId: string };
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.status(400);
      return { error: "consult request 参数不合法", code: "bad_request", issues: parsed.error.issues };
    }
    try {
      const row = await submitConsultRequest({ taskId, nodeId, message: parsed.data.message, targetAgent: parsed.data.target_agent, createdBy: "console_user" });
      reply.status(201);
      return { request: serializeConsultRequest(row) };
    } catch (error) {
      const mapped = mapConsultError(error, reply);
      if (mapped) return mapped;
      throw error;
    }
  });

  app.get("/api/tasks/:taskId/consult-requests/:id", async (request, reply) => {
    const { taskId, id } = request.params as { taskId: string; id: string };
    const row = await getConsultRequest(taskId, id);
    if (!row) {
      reply.status(404);
      return { error: "consult request 不存在", code: "not_found" };
    }
    return { request: serializeConsultRequest(row) };
  });

  app.delete("/api/tasks/:taskId/consult-requests/:id", async (request, reply) => {
    if (!requireCcbToken(request, reply)) return reply;
    const { taskId, id } = request.params as { taskId: string; id: string };
    try {
      return { request: serializeConsultRequest(await cancelConsultRequest(taskId, id)) };
    } catch (error) {
      const mapped = mapConsultError(error, reply);
      if (mapped) return mapped;
      throw error;
    }
  });
}
