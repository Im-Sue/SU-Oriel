import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "../../db/prisma.js";
import { CwdInvalidError, resolveLaunchCwd } from "./ai-cli.cwd.js";
import { AI_CLI_ERROR_CODES, AiCliError } from "./ai-cli.errors.js";
import { ExternalLaunchError, launchExternal } from "./ai-cli.external.js";
import { assertLocalRequest } from "./ai-cli.guard.js";
import { sharedPtyManager } from "./ai-cli.pty.js";
import { sharedRecordingStore } from "./ai-cli.recording.js";
import { RateLimiter } from "./ai-cli.rate-limit.js";
import { AI_CLI_TOOL_DEFINITIONS, resolveExecutable } from "./ai-cli.registry.js";
import {
  AiCliSettingsStore,
  resolveEffectiveSetting
} from "./ai-cli.settings.store.js";
import {
  createSessionSchema,
  launchSchema,
  settingDeleteSchema,
  settingUpsertSchema
} from "./ai-cli.schemas.js";
import { AI_CLI_TOOLS, type AiCliToolResolved } from "./ai-cli.types.js";

const launchLimiter = new RateLimiter(60_000, 30);
const sessionLimiter = new RateLimiter(60_000, 30);

export async function registerAiCliRoutes(app: FastifyInstance): Promise<void> {
  const settingsStore = new AiCliSettingsStore(prisma);

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/ai-cli")) {
      return;
    }
    try {
      assertLocalRequest(request);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode ?? 403;
      reply.status(status);
      throw error;
    }
  });

  app.get("/api/ai-cli/tools", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    const records = await settingsStore.listForProject(projectId ?? null);

    const items: AiCliToolResolved[] = AI_CLI_TOOLS.map((toolId) => {
      const def = AI_CLI_TOOL_DEFINITIONS[toolId];
      const effective = resolveEffectiveSetting(toolId, projectId ?? null, records);
      const resolvedPath = resolveExecutable(effective.command);
      return {
        id: def.id,
        name: def.name,
        command: effective.command,
        resolvedPath,
        available: resolvedPath !== null,
        args: effective.extraArgs,
        defaultMode: effective.defaultMode,
        installHint: def.installHint
      };
    });

    return { items };
  });

  app.get("/api/ai-cli/settings", async () => {
    return { items: await settingsStore.list() };
  });

  app.put("/api/ai-cli/settings", async (request, reply) => {
    const parsed = settingUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: "AI CLI 设置参数不合法",
        issues: parsed.error.issues
      };
    }

    if (parsed.data.scope === "project" && !parsed.data.projectId) {
      reply.status(400);
      return { message: "项目级设置必须提供 projectId" };
    }

    try {
      const record = await settingsStore.upsert({
        scope: parsed.data.scope,
        projectId: parsed.data.projectId ?? null,
        toolId: parsed.data.toolId,
        command: parsed.data.command ?? null,
        extraArgs: parsed.data.extraArgs ?? [],
        defaultMode: parsed.data.defaultMode ?? null
      });
      return record;
    } catch (error) {
      reply.status(400);
      return { message: error instanceof Error ? error.message : "保存设置失败" };
    }
  });

  app.delete("/api/ai-cli/settings", async (request, reply) => {
    const parsed = settingDeleteSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: "AI CLI 设置删除参数不合法",
        issues: parsed.error.issues
      };
    }
    await settingsStore.remove(
      parsed.data.scope,
      parsed.data.projectId ?? null,
      parsed.data.toolId
    );
    reply.status(204);
    return;
  });

  app.post("/api/ai-cli/launch", async (request, reply) => {
    const parsed = launchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { message: "启动参数不合法", issues: parsed.error.issues };
    }

    try {
      launchLimiter.check(`${request.ip}:launch`);
    } catch (error) {
      return respondWithAiCliError(reply, error);
    }

    const { toolId, projectId } = parsed.data;
    const records = await settingsStore.listForProject(projectId ?? null);
    const effective = resolveEffectiveSetting(toolId, projectId ?? null, records);

    const executable = resolveExecutable(effective.command);
    if (!executable) {
      reply.status(400);
      return {
        code: AI_CLI_ERROR_CODES.TOOL_NOT_FOUND,
        message: `未在系统中检测到 ${effective.command}，请先安装或在设置中指定可执行路径`,
        installHint: AI_CLI_TOOL_DEFINITIONS[toolId].installHint
      };
    }

    let cwdInfo;
    try {
      cwdInfo = await resolveLaunchCwd(prisma, projectId ?? null);
    } catch (error) {
      if (error instanceof CwdInvalidError) {
        reply.status(400);
        return { code: error.code, message: error.message };
      }
      throw error;
    }

    try {
      const result = launchExternal({
        command: effective.command,
        args: effective.extraArgs,
        cwd: cwdInfo.cwd
      });

      app.log.info(
        {
          event: "ai-cli.launch.external",
          ip: request.ip,
          toolId,
          projectId: cwdInfo.projectId,
          cwd: cwdInfo.cwd,
          terminalKind: result.terminalKind,
          pid: result.pid
        },
        "ai-cli external launched"
      );

      return {
        toolId,
        command: effective.command,
        cwd: cwdInfo.cwd,
        terminalKind: result.terminalKind,
        pid: result.pid
      };
    } catch (error) {
      if (error instanceof ExternalLaunchError) {
        reply.status(400);
        return { code: error.code, message: error.message };
      }
      app.log.error({ event: "ai-cli.launch.external.failed", err: error });
      reply.status(500);
      return { code: AI_CLI_ERROR_CODES.EXTERNAL_LAUNCH_FAILED, message: "外部终端启动失败" };
    }
  });

  app.get("/api/ai-cli/sessions", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    const items = sharedPtyManager.list().filter((session) => {
      if (projectId === undefined) {
        return true;
      }
      return session.projectId === (projectId || null);
    });
    return { items };
  });

  app.get("/api/ai-cli/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const descriptor = sharedPtyManager.get(sessionId);
    if (!descriptor) {
      reply.status(404);
      return { code: AI_CLI_ERROR_CODES.SESSION_NOT_FOUND, message: "会话不存在或已结束" };
    }
    return descriptor;
  });

  app.delete("/api/ai-cli/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const descriptor = sharedPtyManager.get(sessionId);
    if (!descriptor) {
      reply.status(404);
      return { code: AI_CLI_ERROR_CODES.SESSION_NOT_FOUND, message: "会话不存在" };
    }
    sharedPtyManager.kill(sessionId, "USER_DELETE");
    app.log.info(
      { event: "ai-cli.session.deleted", sessionId, ip: request.ip },
      "ai-cli session deleted"
    );
    reply.status(204);
    return;
  });

  app.post("/api/ai-cli/sessions", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { message: "会话参数不合法", issues: parsed.error.issues };
    }

    try {
      sessionLimiter.check(`${request.ip}:session`);
    } catch (error) {
      return respondWithAiCliError(reply, error);
    }

    const { toolId, projectId, cols, rows, shellWrap = true, record = true } = parsed.data;
    const records = await settingsStore.listForProject(projectId ?? null);
    const effective = resolveEffectiveSetting(toolId, projectId ?? null, records);
    const executable = resolveExecutable(effective.command);
    if (!executable) {
      reply.status(400);
      return {
        code: AI_CLI_ERROR_CODES.TOOL_NOT_FOUND,
        message: `未在系统中检测到 ${effective.command}，请先安装或在设置中指定可执行路径`,
        installHint: AI_CLI_TOOL_DEFINITIONS[toolId].installHint
      };
    }

    let cwdInfo;
    try {
      cwdInfo = await resolveLaunchCwd(prisma, projectId ?? null);
    } catch (error) {
      if (error instanceof CwdInvalidError) {
        reply.status(400);
        return { code: error.code, message: error.message };
      }
      throw error;
    }

    try {
      const descriptor = sharedPtyManager.create({
        toolId,
        command: effective.command,
        args: effective.extraArgs,
        cwd: cwdInfo.cwd,
        projectId: cwdInfo.projectId,
        cols,
        rows,
        shellWrap,
        recordingStore: record ? sharedRecordingStore : null
      });

      app.log.info(
        {
          event: "ai-cli.session.created",
          ip: request.ip,
          sessionId: descriptor.id,
          toolId,
          projectId: cwdInfo.projectId,
          cwd: cwdInfo.cwd,
          cols: descriptor.cols,
          rows: descriptor.rows,
          recording: descriptor.recordingId
        },
        "ai-cli session created"
      );

      return {
        descriptor,
        wsPath: `/ws/ai-cli/${descriptor.id}`
      };
    } catch (error) {
      return respondWithAiCliError(reply, error);
    }
  });

  app.get("/api/ai-cli/recordings", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    const filter = projectId === undefined ? undefined : { projectId: projectId || null };
    return { items: sharedRecordingStore.list(filter) };
  });

  app.get("/api/ai-cli/recordings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return sharedRecordingStore.read(id);
    } catch (error) {
      return respondWithAiCliError(reply, error);
    }
  });

  app.delete("/api/ai-cli/recordings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    sharedRecordingStore.delete(id);
    app.log.info({ event: "ai-cli.recording.deleted", id, ip: request.ip }, "ai-cli recording deleted");
    reply.status(204);
    return;
  });
}

function respondWithAiCliError(reply: FastifyReply, error: unknown) {
  if (error instanceof AiCliError) {
    reply.status(error.statusCode);
    return { code: error.code, message: error.message };
  }
  reply.status(500);
  return {
    code: "INTERNAL",
    message: error instanceof Error ? error.message : "未知错误"
  };
}

// 让 TypeScript 知道 FastifyRequest 有 ip 字段（默认就有）
export type AiCliFastifyRequest = FastifyRequest;
