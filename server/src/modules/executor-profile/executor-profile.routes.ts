import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import { executorProfilePayloadSchema } from "./executor-profile.schemas.js";
import { getExecutorProfile, listExecutorProfiles, upsertExecutorProfile } from "./executor-profile.service.js";

export async function registerExecutorProfileRoutes(routes: FastifyInstance): Promise<void> {
  routes.get("/api/projects/:projectId/executor-profiles", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const profiles = await listExecutorProfiles(prisma, projectId);

    if (!profiles) {
      reply.status(404);
      return {
        message: "项目不存在"
      };
    }

    return profiles;
  });

  routes.get("/api/projects/:projectId/executor-profiles/:profileId", async (request, reply) => {
    const { projectId, profileId } = request.params as { projectId: string; profileId: string };
    const profile = await getExecutorProfile(prisma, projectId, profileId);

    if (!profile) {
      reply.status(404);
      return {
        message: "ExecutorProfile 不存在"
      };
    }

    return profile;
  });

  routes.put("/api/projects/:projectId/executor-profiles/:profileId", async (request, reply) => {
    const { projectId, profileId } = request.params as { projectId: string; profileId: string };
    const parsed = executorProfilePayloadSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "executor profile schema validation failed",
        issues: parsed.error.issues
      };
    }

    const profile = await upsertExecutorProfile(prisma, projectId, profileId, parsed.data);

    if (!profile) {
      reply.status(404);
      return {
        message: "项目不存在"
      };
    }

    return profile;
  });
}
