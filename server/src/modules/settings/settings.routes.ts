import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import type { FileWatcherLifecycle } from "../../fs/file-watcher-service.js";
import { getProjectSettings, upsertProjectSettings } from "./settings.service.js";
import { projectSettingsPayloadSchema } from "./settings.schemas.js";

export interface SettingsRouteDependencies {
  fileWatcherService?: FileWatcherLifecycle | null;
}

export async function registerSettingsRoutes(
  routes: FastifyInstance,
  dependencies: SettingsRouteDependencies = {}
): Promise<void> {
  routes.get("/api/projects/:projectId/settings", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const settings = await getProjectSettings(prisma, projectId);

    if (!settings) {
      reply.status(404);
      return {
        message: "项目不存在"
      };
    }

    return settings;
  });

  routes.put("/api/projects/:projectId/settings", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = projectSettingsPayloadSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "settings 参数不合法",
        issues: parsed.error.issues
      };
    }

    const settings = await upsertProjectSettings(prisma, projectId, parsed.data);

    if (!settings) {
      reply.status(404);
      return {
        message: "项目不存在"
      };
    }

    if (dependencies.fileWatcherService) {
      if (parsed.data.scan_strategy.enabled) {
        await dependencies.fileWatcherService.start();
      } else {
        await dependencies.fileWatcherService.stop();
      }
    }

    return settings;
  });
}
