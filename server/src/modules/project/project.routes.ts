import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import { deriveScanPhase, getLatestProjectScanJob, startProjectScan } from "../../indexer/project-indexer.js";
import { createProjectSchema } from "./project.schemas.js";
import type { ProjectStore } from "./project.types.js";
import type { FileWatcherLifecycle } from "../../fs/file-watcher-service.js";

export interface ProjectRouteOptions {
  projectStore: ProjectStore;
  fileWatcherService?: FileWatcherLifecycle | null;
}

export async function registerProjectRoutes(
  app: FastifyInstance,
  options: ProjectRouteOptions
): Promise<void> {
  app.get("/api/projects", async () => {
    return {
      items: await options.projectStore.list()
    };
  });

  app.post("/api/projects", async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: "项目创建参数不合法",
        issues: parsed.error.issues
      };
    }

    const project = await options.projectStore.create(parsed.data);
    let scanStart: Awaited<ReturnType<typeof startProjectScan>> | null = null;
    try {
      const persistedProject = await prisma.project.findUnique({
        where: {
          id: project.id
        },
        select: {
          id: true
        }
      });
      if (persistedProject) {
        scanStart = await startProjectScan(prisma, project.id, request.log);
      }
    } catch (error) {
      request.log.error({ err: error, projectId: project.id }, "project background scan start failed");
    }
    try {
      await options.fileWatcherService?.ensureProjectWatcher?.(project.id, { backfill: false });
    } catch (error) {
      request.log.error({ err: error, projectId: project.id }, "project watcher registration failed");
    }
    reply.status(201);
    return {
      ...project,
      ...(scanStart ? { syncStatus: scanStart.projectSyncStatus, scanJob: scanStart.job } : {})
    };
  });

  app.get("/api/projects/:projectId/index-health", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await prisma.project.findUnique({
      where: {
        id: projectId
      }
    });

    if (!project) {
      reply.status(404);
      return {
        message: "项目不存在"
      };
    }

    const [documentCount, taskCount, requirementCount, failedParseJobs, failedDocuments] =
      await Promise.all([
        prisma.document.count({
          where: {
            projectId
          }
        }),
        prisma.task.count({
          where: {
            projectId
          }
        }),
        prisma.requirement.count({
          where: {
            projectId
          }
        }),
        prisma.syncJob.count({
          where: {
            projectId,
            jobType: "parse",
            status: "failed",
            startedAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            }
          }
        }),
        prisma.document.count({
          where: {
            projectId,
            parseStatus: {
              not: "success"
            }
          }
        })
      ]);

    const lastScanAt = project.lastScanAt?.toISOString() ?? null;
    const freshness = project.lastScanAt
      ? Date.now() - project.lastScanAt.getTime() <= 24 * 60 * 60 * 1000
      : false;

    reply.header("Cache-Control", "max-age=60");
    return {
      projectId,
      lastScanAt,
      documentCount,
      taskCount,
      requirementCount,
      parseFailureCount: failedParseJobs + failedDocuments,
      freshness
    };
  });

  app.post("/api/projects/:projectId/scan", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const project = await prisma.project.findUnique({
      where: {
        id: projectId
      },
      select: {
        id: true
      }
    });
    if (!project) {
      reply.status(404);
      return {
        message: "项目不存在，请重新创建或选择项目"
      };
    }

    const result = await startProjectScan(prisma, projectId, request.log);
    reply.status(202);
    return {
      message: result.started ? "项目文档扫描已开始" : "项目文档扫描正在进行",
      status: result.projectSyncStatus,
      job: result.job
    };
  });

  app.get("/api/projects/:projectId/scan-status", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const project = await prisma.project.findUnique({
      where: {
        id: projectId
      },
      select: {
        id: true,
        syncStatus: true
      }
    });
    if (!project) {
      reply.status(404);
      return {
        message: "项目不存在，请重新创建或选择项目"
      };
    }

    const [job, phase] = await Promise.all([
      getLatestProjectScanJob(prisma, projectId),
      deriveScanPhase(prisma, projectId)
    ]);

    return {
      projectId,
      projectSyncStatus: project.syncStatus,
      status: job?.status ?? project.syncStatus,
      processedCount: job?.processedCount ?? 0,
      totalCount: job?.totalCount ?? 0,
      errorMessage: job?.errorMessage ?? null,
      jobId: job?.id ?? null,
      updatedAt: job?.updatedAt ?? null,
      phase: phase.phase,
      phaseStatus: phase.phaseStatus,
      phaseJobId: phase.phaseJobId,
      phaseErrorMessage: phase.phaseErrorMessage
    };
  });
}
