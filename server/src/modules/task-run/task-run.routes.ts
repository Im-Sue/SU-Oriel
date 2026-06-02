import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  cancelTaskRun,
  dispatchTaskRun,
  pauseTaskRun,
  retryTaskRun,
  resumeTaskRun,
  taskRunErrorToStatus
} from "./task-run.service.js";

const taskRunParamsSchema = z
  .object({
    taskId: z.string().trim().min(1)
  })
  .strict();

const dispatchBodySchema = z
  .object({
    attempt_n: z.number().int().min(1).optional(),
    force: z.boolean().optional()
  })
  .strict();

const queryBooleanSchema = z.preprocess((value) => {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
}, z.boolean().optional());

const dispatchQuerySchema = z
  .object({
    force: queryBooleanSchema
  })
  .strict();

export async function registerTaskRunRoutes(routes: FastifyInstance): Promise<void> {
  routes.post("/api/task-runs/:taskId/dispatch", async (request, reply) => {
    const params = taskRunParamsSchema.safeParse(request.params);
    const body = dispatchBodySchema.safeParse(request.body ?? {});
    const query = dispatchQuerySchema.safeParse(request.query ?? {});

    if (!params.success || !body.success || !query.success) {
      reply.status(400);
      return {
        message: "TaskRun dispatch payload 不合法",
        issues: [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
          ...(query.success ? [] : query.error.issues)
        ]
      };
    }

    try {
      return await dispatchTaskRun(params.data.taskId, body.data.attempt_n, {
        force: body.data.force ?? query.data.force
      });
    } catch (error) {
      const mapped = taskRunErrorToStatus(error);
      if (mapped) {
        reply.status(mapped.statusCode);
        return mapped.body;
      }
      throw error;
    }
  });

  routes.post("/api/task-runs/:taskId/retry", async (request, reply) => {
    const params = taskRunParamsSchema.safeParse(request.params);

    if (!params.success) {
      reply.status(400);
      return {
        message: "TaskRun retry payload 不合法",
        issues: params.error.issues
      };
    }

    try {
      return await retryTaskRun(params.data.taskId);
    } catch (error) {
      const mapped = taskRunErrorToStatus(error);
      if (mapped) {
        reply.status(mapped.statusCode);
        return mapped.body;
      }
      throw error;
    }
  });

  routes.post("/api/task-runs/:taskId/pause", async (request, reply) => {
    const params = taskRunParamsSchema.safeParse(request.params);

    if (!params.success) {
      reply.status(400);
      return {
        message: "TaskRun pause payload 不合法",
        issues: params.error.issues
      };
    }

    try {
      return await pauseTaskRun(params.data.taskId);
    } catch (error) {
      const mapped = taskRunErrorToStatus(error);
      if (mapped) {
        reply.status(mapped.statusCode);
        return mapped.body;
      }
      throw error;
    }
  });

  routes.post("/api/task-runs/:taskId/resume", async (request, reply) => {
    const params = taskRunParamsSchema.safeParse(request.params);

    if (!params.success) {
      reply.status(400);
      return {
        message: "TaskRun resume payload 不合法",
        issues: params.error.issues
      };
    }

    try {
      return await resumeTaskRun(params.data.taskId);
    } catch (error) {
      const mapped = taskRunErrorToStatus(error);
      if (mapped) {
        reply.status(mapped.statusCode);
        return mapped.body;
      }
      throw error;
    }
  });

  routes.post("/api/task-runs/:taskId/cancel", async (request, reply) => {
    const params = taskRunParamsSchema.safeParse(request.params);

    if (!params.success) {
      reply.status(400);
      return {
        message: "TaskRun cancel payload 不合法",
        issues: params.error.issues
      };
    }

    try {
      return await cancelTaskRun(params.data.taskId);
    } catch (error) {
      const mapped = taskRunErrorToStatus(error);
      if (mapped) {
        reply.status(mapped.statusCode);
        return mapped.body;
      }
      throw error;
    }
  });
}
