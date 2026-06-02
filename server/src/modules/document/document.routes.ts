import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import { deriveDocumentGovernance } from "../../indexer/document-governance.js";
import {
  getDocsStructureResolver,
  getDocsStructureResolverForProject
} from "../../indexer/docs-structure-resolver.js";

/** Coerce a parsed frontmatterJson object into the string-keyed shape the governance builder expects. */
function toStringFrontmatter(raw: unknown): Record<string, string | undefined> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = value == null ? undefined : typeof value === "string" ? value : String(value);
  }
  return out;
}

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects/:projectId/documents", async (request) => {
    const { projectId } = request.params as { projectId: string };

    const documents = await prisma.document.findMany({
      where: {
        projectId
      },
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }]
    });

    // 不存在的 projectId / 空项目:保持既有「返回空列表」行为(不改成 404)。
    if (documents.length === 0) {
      return { items: [] };
    }

    // 防 N+1:一次性取全量 requirement 状态 ctx，一次取 project.localPath 构造 resolver。
    const [requirements, project] = await Promise.all([
      prisma.requirement.findMany({ where: { projectId }, select: { id: true, status: true } }),
      prisma.project.findUnique({ where: { id: projectId }, select: { localPath: true } })
    ]);
    const requirementStatusById = new Map(requirements.map((r) => [r.id, r.status?.trim() || "drafting"]));
    const resolver = project ? getDocsStructureResolverForProject(project.localPath) : getDocsStructureResolver();
    const archiveDirectory = resolver.resolveDocType("archive_index").directory;

    return {
      items: documents.map((document) => {
        const resolved = resolver.availableDocTypes.includes(document.kind) ? resolver.resolveDocType(document.kind) : null;
        // governance 仅挂 list 响应;detail 路由不变。复用 pr1 deriveDocumentGovernance,杜绝规则分叉。
        const governance = deriveDocumentGovernance(
          {
            kind: document.kind,
            isArchivePath: document.path.startsWith(archiveDirectory),
            taskKey: document.taskKey,
            frontmatter: toStringFrontmatter(document.frontmatterJson ? JSON.parse(document.frontmatterJson) : {}),
            parseStatus: document.parseStatus
          },
          {
            requirementStatusById,
            docTypeInfo: resolved ? { hasStatus: resolved.hasStatus, followsEntity: resolved.followsEntity } : null
          }
        );
        return {
          id: document.id,
          projectId: document.projectId,
          taskKey: document.taskKey,
          path: document.path,
          kind: document.kind,
          title: document.title,
          status: document.status,
          summary: document.summary,
          parseStatus: document.parseStatus,
          mtime: document.mtime.toISOString(),
          updatedAt: document.updatedAt.toISOString(),
          governance
        };
      })
    };
  });

  app.get("/api/documents/:documentId", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };

    const document = await prisma.document.findUnique({
      where: {
        id: documentId
      },
      include: {
        project: true
      }
    });

    if (!document) {
      reply.status(404);
      return {
        message: "文档不存在"
      };
    }

    const absolutePath = join(document.project.localPath, document.path);
    const content = await readFile(absolutePath, "utf8");

    return {
      id: document.id,
      projectId: document.projectId,
      taskKey: document.taskKey,
      path: document.path,
      kind: document.kind,
      title: document.title,
      status: document.status,
      summary: document.summary,
      parseStatus: document.parseStatus,
      mtime: document.mtime.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      frontmatter: document.frontmatterJson ? JSON.parse(document.frontmatterJson) : {},
      content
    };
  });
}
