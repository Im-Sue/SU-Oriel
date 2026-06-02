import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects/:projectId/sync-jobs", async (request) => {
    const { projectId } = request.params as { projectId: string };

    const jobs = await prisma.syncJob.findMany({
      where: {
        projectId
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }]
    });

    return {
      items: jobs.map((job) => ({
        id: job.id,
        projectId: job.projectId,
        jobType: job.jobType,
        status: job.status,
        processedCount: job.processedCount,
        totalCount: job.totalCount,
        startedAt: job.startedAt.toISOString(),
        finishedAt: job.finishedAt?.toISOString() ?? null,
        logSummary: job.logSummary,
        errorMessage: job.errorMessage,
        updatedAt: job.updatedAt.toISOString()
      }))
    };
  });
}
