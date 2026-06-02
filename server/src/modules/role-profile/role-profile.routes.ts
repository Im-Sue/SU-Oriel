import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import { roleProfilePayloadSchema } from "./role-profile.schemas.js";
import {
  getRoleProfile,
  listRoleProfiles,
  upsertRoleProfile,
  validateRoleProfileReferences
} from "./role-profile.service.js";

export async function registerRoleProfileRoutes(routes: FastifyInstance): Promise<void> {
  routes.get("/api/projects/:projectId/role-profiles", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const profiles = await listRoleProfiles(prisma, projectId);

    if (!profiles) {
      reply.status(404);
      return {
        message: "项目不存在"
      };
    }

    return profiles;
  });

  routes.get("/api/projects/:projectId/role-profiles/:roleId", async (request, reply) => {
    const { projectId, roleId } = request.params as { projectId: string; roleId: string };
    const profile = await getRoleProfile(prisma, projectId, roleId);

    if (!profile) {
      reply.status(404);
      return {
        message: "RoleProfile 不存在"
      };
    }

    return profile;
  });

  routes.put("/api/projects/:projectId/role-profiles/:roleId", async (request, reply) => {
    const { projectId, roleId } = request.params as { projectId: string; roleId: string };
    const parsed = roleProfilePayloadSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "role profile schema validation failed",
        issues: parsed.error.issues
      };
    }

    const validation = await validateRoleProfileReferences(prisma, projectId, parsed.data);
    if (!validation.ok) {
      reply.status(400);
      return {
        message: validation.message,
        issues: validation.issues ?? []
      };
    }

    const profile = await upsertRoleProfile(prisma, projectId, roleId, parsed.data, validation.executorProfile);

    if (!profile) {
      reply.status(404);
      return {
        message: "项目不存在"
      };
    }

    return profile;
  });
}
