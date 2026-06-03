import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import type { PrismaClient, Requirement } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import {
  createRequirement,
  generateRequirementId
} from "../../indexer/project-indexer.js";
import {
  RequirementEditHashConflictError,
  RequirementEditNotFoundError,
  RequirementEditStatusConflictError,
  editRequirement,
  loadRequirementMarkdownBody,
  loadRequirementMdHash
} from "./requirement-edit.service.js";
import { createRequirementSchema, editRequirementSchema } from "./requirement.schemas.js";
import {
  REQUIREMENT_ASSET_MAX_BYTES,
  RequirementAssetError,
  finalizeRequirementAssets,
  rewriteRequirementAssetReferences,
  storeRequirementAsset,
  toTmpRequirementAssetOwner,
  validateRequirementAssetOwner
} from "./requirement-assets.service.js";
import {
  RequirementAnchorUnavailableError,
  RequirementAiUnavailableError,
  RequirementReanalyzeNoAnchorError,
  RequirementReanalyzeNotFoundError,
  RequirementReanalyzeStatusConflictError,
  getRequirementReanalyzeJobStatus,
  reanalyzeRequirement
} from "./requirement-reanalyze.service.js";
import type { RequirementReanalyzeDispatcher } from "./requirement-reanalyze.service.js";
import {
  reindexRequirementScope as defaultReindexRequirementScope,
  type RequirementScopedReindexResult
} from "./requirement-reindex.service.js";

type ReindexRequirementScopeFn = (
  prismaClient: PrismaClient,
  projectId: string,
  requirementId: string
) => Promise<RequirementScopedReindexResult>;

export interface RequirementRouteDependencies {
  dispatcher?: RequirementReanalyzeDispatcher;
  reindexRequirementScope?: ReindexRequirementScopeFn;
}

function serializeRequirement(requirement: Requirement) {
  return {
    id: requirement.id,
    projectId: requirement.projectId,
    title: requirement.title,
    description: requirement.description,
    status: requirement.status,
    source: requirement.source,
    outputMode: "requirement_only",
    splitMode: "direct_pr",
    generatedTaskId: null,
    sourceTaskId: null,
    verbatimSource: requirement.verbatimSource,
    claudeInterpretation: requirement.claudeInterpretation,
    ambiguities: requirement.ambiguities,
    fidelityDiff: requirement.fidelityDiff,
    analysisInputHash: requirement.analysisInputHash,
    analysisStaleAt: requirement.analysisStaleAt ? requirement.analysisStaleAt.toISOString() : null,
    currentPlanningNode: requirement.currentPlanningNode,
    currentPlanningStep: requirement.currentPlanningStep,
    planningSubstate: requirement.planningSubstate,
    planningRuntimeState: requirement.planningRuntimeState,
    lastPlanningTransitionId: requirement.lastPlanningTransitionId,
    planRevision: 0,
    planDocPath: requirement.planDocPath,
    breakdownDraftPath: requirement.breakdownDraftPath,
    planningAnchorId: requirement.planningAnchorId,
    rollupProgress: requirement.rollupProgress,
    rollupStatus: requirement.rollupStatus,
    createdAt: requirement.createdAt.toISOString(),
    updatedAt: requirement.updatedAt.toISOString()
  };
}

type FastifyErrorLike = {
  code?: string;
  message?: string;
};

function isMultipartFileTooLarge(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as FastifyErrorLike;
  return candidate.code === "FST_REQ_FILE_TOO_LARGE" || candidate.message === "request file too large";
}

export async function registerRequirementRoutes(
  app: FastifyInstance,
  dependencies: RequirementRouteDependencies = {}
): Promise<void> {
  const reindexRequirementScope = dependencies.reindexRequirementScope ?? defaultReindexRequirementScope;

  app.get("/api/projects/:projectId/requirements", async (request) => {
    const { projectId } = request.params as { projectId: string };

    const requirements = await prisma.requirement.findMany({
      where: {
        projectId
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return {
      items: requirements.map((requirement) => serializeRequirement(requirement))
    };
  });

  app.get("/api/projects/:projectId/requirements/:requirementId", async (request, reply) => {
    const { projectId, requirementId } = request.params as { projectId: string; requirementId: string };

    const requirement = await prisma.requirement.findFirst({
      where: { id: requirementId, projectId }
    });
    if (!requirement) {
      reply.status(404);
      return { message: "需求不存在" };
    }

    let mdHash: string | null = null;
    try {
      mdHash = await loadRequirementMdHash(prisma, projectId, requirementId);
    } catch (error) {
      if (!(error instanceof RequirementEditNotFoundError)) {
        throw error;
      }
      // 编辑窗口下需要 mdHash；找不到 md 时给 null，前端禁用编辑
    }

    return {
      ...serializeRequirement(requirement),
      mdHash
    };
  });

  app.get("/api/projects/:projectId/requirements/:requirementId/markdown", async (request, reply) => {
    const { projectId, requirementId } = request.params as { projectId: string; requirementId: string };

    try {
      return await loadRequirementMarkdownBody(prisma, projectId, requirementId);
    } catch (error) {
      if (error instanceof RequirementEditNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      throw error;
    }
  });

  app.post("/api/projects/:projectId/requirements/:assetOwner/assets", async (request, reply) => {
    const { projectId, assetOwner } = request.params as { projectId: string; assetOwner: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { localPath: true }
    });
    if (!project) {
      reply.status(404);
      return { message: "项目不存在" };
    }

    let safeOwner: string;
    try {
      safeOwner = validateRequirementAssetOwner(assetOwner);
    } catch (error) {
      reply.status(400);
      return { message: error instanceof Error ? error.message : "图片目录参数不合法" };
    }

    try {
      const file = await request.file({
        limits: { fileSize: REQUIREMENT_ASSET_MAX_BYTES },
        throwFileSizeLimit: true
      });
      if (!file) {
        reply.status(400);
        return { message: "请选择要上传的图片" };
      }
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.mimetype)) {
        file.file.resume();
        reply.status(400);
        return { message: "仅支持 png / jpeg / webp / gif 图片格式" };
      }

      const buffer = await file.toBuffer();
      const result = await storeRequirementAsset(project.localPath, safeOwner, buffer, file.mimetype);
      reply.status(201);
      return result;
    } catch (error) {
      reply.status(400);
      if (isMultipartFileTooLarge(error)) {
        return { message: "图片不能超过 5MB" };
      }
      if (error instanceof RequirementAssetError) {
        return { message: error.message };
      }
      return { message: error instanceof Error ? error.message : "图片上传失败" };
    }
  });

  app.get("/api/projects/:projectId/requirements/:assetOwner/assets/:filename", async (request, reply) => {
    const { projectId, assetOwner, filename } = request.params as {
      projectId: string;
      assetOwner: string;
      filename: string;
    };

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { localPath: true }
    });
    if (!project) {
      reply.status(404);
      return { message: "项目不存在" };
    }

    let safeOwner: string;
    try {
      safeOwner = validateRequirementAssetOwner(assetOwner);
    } catch (error) {
      reply.status(400);
      return { message: error instanceof Error ? error.message : "图片目录参数不合法" };
    }

    // 防 path traversal：filename 仅允许 hash.ext 形式
    if (!/^[A-Fa-f0-9]{1,128}\.(png|jpg|jpeg|webp|gif)$/i.test(filename)) {
      reply.status(400);
      return { message: "图片文件名不合法" };
    }

    const filePath = join(
      project.localPath,
      "docs",
      ".ccb",
      "assets",
      "requirements",
      safeOwner,
      filename
    );
    try {
      const buffer = await readFile(filePath);
      const ext = filename.split(".").pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif"
      };
      reply.header("Content-Type", mimeMap[ext ?? ""] ?? "application/octet-stream");
      reply.header("Cache-Control", "public, max-age=3600");
      return buffer;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reply.status(404);
        return { message: "图片不存在" };
      }
      throw error;
    }
  });

  app.post("/api/projects/:projectId/requirements", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createRequirementSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "需求创建参数不合法",
        issues: parsed.error.issues
      };
    }

    const requirementId = parsed.data.asset_tmp_uuid ? generateRequirementId() : undefined;
    const rewriteAssetRefs = (value: string | undefined) =>
      parsed.data.asset_tmp_uuid && requirementId
        ? rewriteRequirementAssetReferences(value, parsed.data.asset_tmp_uuid, requirementId)
        : value;
    const description = rewriteAssetRefs(parsed.data.description) ?? parsed.data.description;
    const project = parsed.data.asset_tmp_uuid
      ? await prisma.project.findUnique({ where: { id: projectId }, select: { localPath: true } })
      : null;
    if (parsed.data.asset_tmp_uuid && !project) {
      reply.status(404);
      return { message: "项目不存在" };
    }

    const result = await createRequirement(prisma, projectId, {
      requirementId,
      title: parsed.data.title,
      description,
      verbatimSource: rewriteAssetRefs(parsed.data.verbatim_source),
      claudeInterpretation: rewriteAssetRefs(parsed.data.claude_interpretation),
      ambiguities: rewriteAssetRefs(parsed.data.ambiguities),
      fidelityDiff: rewriteAssetRefs(parsed.data.fidelity_diff)
    });
    if (parsed.data.asset_tmp_uuid && project) {
      await finalizeRequirementAssets(project.localPath, toTmpRequirementAssetOwner(parsed.data.asset_tmp_uuid), result.requirementId);
    }
    const requirement = await prisma.requirement.findUniqueOrThrow({
      where: {
        id: result.requirementId
      }
    });

    reply.status(201);
    return serializeRequirement(requirement);
  });

  app.patch("/api/projects/:projectId/requirements/:requirementId", async (request, reply) => {
    const { projectId, requirementId } = request.params as { projectId: string; requirementId: string };
    const parsed = editRequirementSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "需求编辑参数不合法",
        issues: parsed.error.issues
      };
    }

    const rawActor = request.headers["x-ccb-actor"];
    const editor = Array.isArray(rawActor) ? rawActor[0] : rawActor;

    try {
      const requirement = await editRequirement(prisma, projectId, requirementId, {
        title: parsed.data.title,
        description: parsed.data.description,
        changeReason: parsed.data.changeReason,
        expectedMdHash: parsed.data.expectedMdHash,
        editor: editor?.trim() || "system"
      });
      return serializeRequirement(requirement);
    } catch (error) {
      if (error instanceof RequirementEditNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      if (error instanceof RequirementEditStatusConflictError) {
        reply.status(409);
        return {
          message: error.message
        };
      }
      if (error instanceof RequirementEditHashConflictError) {
        reply.status(409);
        return {
          message: error.message,
          expectedMdHash: error.expectedMdHash,
          currentMdHash: error.currentMdHash
        };
      }

      throw error;
    }
  });

  app.post("/api/projects/:projectId/requirements/:requirementId/reanalyze", async (request, reply) => {
    const { projectId, requirementId } = request.params as { projectId: string; requirementId: string };

    try {
      const result = await reanalyzeRequirement(prisma, projectId, requirementId, dependencies.dispatcher);
      reply.status(202);
      return {
        jobId: result.jobId,
        job_id: result.jobId,
        status: result.status,
        requirementId: result.requirementId,
        anchorTaskId: result.anchorTaskId,
        anchorId: result.anchorId
      };
    } catch (error) {
      if (error instanceof RequirementReanalyzeNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      if (error instanceof RequirementReanalyzeStatusConflictError) {
        reply.status(409);
        return {
          code: error.code,
          message: error.message
        };
      }
      if (error instanceof RequirementReanalyzeNoAnchorError) {
        reply.status(409);
        return {
          code: error.code,
          message: error.message
        };
      }
      if (error instanceof RequirementAnchorUnavailableError) {
        reply.status(503).header("retry-after", error.retryAfter);
        return {
          code: error.code,
          message: error.message,
          retryAfter: error.retryAfter
        };
      }
      if (error instanceof RequirementAiUnavailableError) {
        reply.status(503).header("retry-after", error.retryAfter);
        return {
          message: error.message,
          retryAfter: error.retryAfter
        };
      }

      throw error;
    }
  });

  app.post("/api/projects/:projectId/requirements/:requirementId/reindex", async (request, reply) => {
    const { projectId, requirementId } = request.params as { projectId: string; requirementId: string };

    try {
      return await reindexRequirementScope(prisma, projectId, requirementId);
    } catch (error) {
      if (error instanceof RequirementEditNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      throw error;
    }
  });

  app.get("/api/projects/:projectId/requirements/:requirementId/reanalyze-jobs/:jobId", async (request, reply) => {
    const { projectId, requirementId, jobId } = request.params as {
      projectId: string;
      requirementId: string;
      jobId: string;
    };

    try {
      return await getRequirementReanalyzeJobStatus(prisma, projectId, requirementId, jobId, dependencies.dispatcher);
    } catch (error) {
      if (error instanceof RequirementReanalyzeNotFoundError) {
        reply.status(404);
        return {
          message: error.message
        };
      }
      if (error instanceof RequirementReanalyzeNoAnchorError) {
        reply.status(409);
        return {
          code: error.code,
          message: error.message
        };
      }
      if (error instanceof RequirementAnchorUnavailableError) {
        reply.status(503).header("retry-after", error.retryAfter);
        return {
          code: error.code,
          message: error.message,
          retryAfter: error.retryAfter
        };
      }

      throw error;
    }
  });

  app.post("/api/projects/:projectId/requirements/:requirementId/generate-task", async (request, reply) => {
    void request;
    reply.status(410);
    return {
      message: "旧立项接口已废弃，请在需求详情页使用开始分析 / 开始设计 / 生成拆分草案。"
    };
  });
}
