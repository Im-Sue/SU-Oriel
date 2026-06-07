import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply } from "fastify";

import { prisma } from "../../db/prisma.js";
import { assertLocalRequest } from "../ai-cli/ai-cli.guard.js";
import { AiCliError } from "../ai-cli/ai-cli.errors.js";
import { AnchorTerminalManager, AnchorTerminalError } from "./terminal-manager.js";
import { AnchorTerminalRecordingStore, type AnchorTerminalRecordingMeta } from "./recording-store.js";
import type {
  AnchorTerminalExitEvent,
  AnchorTerminalFrameEvent,
  AnchorTerminalLeaseChangedEvent,
  AnchorTerminalViewportAppliedEvent
} from "./types.js";

export interface AnchorTerminalRouteDependencies {
  prismaClient?: PrismaClient;
  manager?: AnchorTerminalManager;
  recordingStore?: AnchorTerminalRecordingStore;
}

export async function registerAnchorTerminalRoutes(
  app: FastifyInstance,
  dependencies: AnchorTerminalRouteDependencies = {}
): Promise<void> {
  const db = dependencies.prismaClient ?? prisma;
  const recordingStore = dependencies.recordingStore ?? new AnchorTerminalRecordingStore();
  const manager =
    dependencies.manager ??
    new AnchorTerminalManager({
      recordingStore,
      anchorResolver: async (anchorId) => await resolveAnchor(db, anchorId)
    });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/anchor-terminal")) {
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

  app.get("/api/anchor-terminal/panes", async (request, reply) => {
    const { anchorId } = request.query as { anchorId?: string };
    const projectId = projectIdFromQuery(request.query);
    if (!anchorId) {
      reply.status(400);
      return { code: "BAD_REQUEST", message: "anchorId is required" };
    }
    if (!projectId) {
      reply.status(400);
      return { code: "BAD_REQUEST", message: "projectId is required" };
    }
    try {
      await assertAnchorInProject(db, anchorId, projectId);
      return { items: await manager.listPanes(anchorId) };
    } catch (error) {
      return respondWithAnchorTerminalError(reply, error);
    }
  });

  app.get("/api/anchor-terminal/ws", { websocket: true }, (socket, request) => {
    try {
      assertLocalRequest(request);
    } catch (error) {
      sendErrorAndClose(socket, "WS_UNAUTHORIZED", errorMessage(error), 1008);
      return;
    }

    const { anchorId, pane } = request.query as { anchorId?: string; pane?: string };
    const projectId = projectIdFromQuery(request.query);
    if (!anchorId || !pane || !projectId) {
      sendErrorAndClose(socket, "BAD_REQUEST", "anchorId, pane, and projectId are required", 1008);
      return;
    }

    const clientId = randomUUID();
    let attached: Awaited<ReturnType<AnchorTerminalManager["attach"]>> | null = null;
    let closed = false;
    const detach = () => {
      if (closed) {
        return;
      }
      closed = true;
      manager.detach(anchorId, pane, clientId);
    };

    void (async () => {
      try {
        await assertAnchorInProject(db, anchorId, projectId);
        attached = await manager.attach({ anchorId, paneName: pane, clientId });
      } catch (error) {
        sendErrorAndClose(socket, errorCode(error), errorMessage(error), wsCloseCode(error));
        return;
      }

      const onFrame = (event: AnchorTerminalFrameEvent) => {
        if (event.anchorId === anchorId && event.pane === pane) {
          sendJson(socket, {
            type: "frame",
            data: event.data,
            cols: event.cols,
            rows: event.rows,
            generation: event.generation
          });
        }
      };
      const onExit = (event: AnchorTerminalExitEvent) => {
        if (event.anchorId !== anchorId || event.pane !== pane) {
          return;
        }
        sendJson(socket, { type: "exit", code: 0, signal: null, reason: event.reason });
        try {
          socket.close(1000, event.reason.slice(0, 120));
        } catch {
          // ignore
        }
      };
      const onLeaseChanged = (event: AnchorTerminalLeaseChangedEvent) => {
        if (event.anchorId !== anchorId || event.pane !== pane) {
          return;
        }
        sendJson(socket, {
          type: "lease_changed",
          hasWriter: event.hasWriter,
          isYou: event.holderClientId === clientId,
          since: event.since
        });
      };
      const onViewportApplied = (event: AnchorTerminalViewportAppliedEvent) => {
        if (event.anchorId !== anchorId || event.pane !== pane) {
          return;
        }
        sendJson(socket, {
          type: "viewport_applied",
          cols: event.cols,
          rows: event.rows
        });
      };

      attached.emitter.on("frame", onFrame);
      attached.emitter.on("exit", onExit);
      attached.emitter.on("lease_changed", onLeaseChanged);
      attached.emitter.on("viewport_applied", onViewportApplied);
      socket.on("close", () => {
        attached?.emitter.off("frame", onFrame);
        attached?.emitter.off("exit", onExit);
        attached?.emitter.off("lease_changed", onLeaseChanged);
        attached?.emitter.off("viewport_applied", onViewportApplied);
      });

      sendJson(socket, { type: "ready", descriptor: attached.descriptor });
      if (attached.lastFrame) {
        sendJson(socket, {
          type: "frame",
          data: attached.lastFrame.data,
          cols: attached.lastFrame.cols,
          rows: attached.lastFrame.rows,
          generation: attached.lastFrame.generation
        });
      }
    })();

    socket.on("message", (raw: Buffer | string) => {
      const action = evaluateAnchorTerminalClientFrame(raw);
      if (action.type === "send") {
        sendJson(socket, action.payload);
      } else if (action.type === "close") {
        detach();
        try {
          socket.close(1000, "client requested close");
        } catch {
          // ignore
        }
      } else if (action.type === "viewport") {
        void manager
          .applyViewport({
            anchorId,
            paneName: pane,
            clientId,
            cols: action.cols,
            rows: action.rows,
            active: action.active
          })
          .catch(() => undefined);
      } else if (action.type === "request_write") {
        try {
          const result = manager.requestWriterLease(anchorId, pane, clientId);
          if (!result.granted) {
            sendJson(socket, {
              type: "lease_denied",
              code: "WRITER_LEASE_TAKEN",
              currentHolder: result.currentHolder
            });
          }
        } catch (error) {
          sendJson(socket, { type: "error", code: errorCode(error), message: errorMessage(error) });
        }
      } else if (action.type === "release_write") {
        manager.releaseWriterLease(anchorId, pane, clientId);
      } else if (action.type === "input") {
        void manager
          .applyInput({
            anchorId,
            paneName: pane,
            clientId,
            data: action.data,
            remoteAddr: request.ip || request.socket.remoteAddress || "unknown"
          })
          .catch((error) => {
            sendJson(socket, { type: "error", code: errorCode(error), message: errorMessage(error) });
          });
      } else if (action.type === "resize") {
        void manager
          .applyWriteResize({
            anchorId,
            paneName: pane,
            clientId,
            cols: action.cols,
            rows: action.rows
          })
          .catch((error) => {
            sendJson(socket, { type: "error", code: errorCode(error), message: errorMessage(error) });
          });
      }
    });

    socket.on("close", detach);
  });

  app.get("/api/anchor-terminal/recordings", async (request, reply) => {
    const { anchorId } = request.query as { anchorId?: string };
    const projectId = projectIdFromQuery(request.query);
    if (!projectId) {
      reply.status(400);
      return { code: "BAD_REQUEST", message: "projectId is required" };
    }
    try {
      if (anchorId) {
        await assertAnchorInProject(db, anchorId, projectId);
        return { items: recordingStore.list({ anchorId }) };
      }
      return { items: await filterRecordingsForProject(db, recordingStore.list(), projectId) };
    } catch (error) {
      return respondWithAnchorTerminalError(reply, error);
    }
  });

  app.get("/api/anchor-terminal/recordings/:id/cast", async (request, reply) => {
    const { id } = request.params as { id: string };
    const projectId = projectIdFromQuery(request.query);
    if (!projectId) {
      reply.status(400);
      return { code: "BAD_REQUEST", message: "projectId is required" };
    }
    try {
      const payload = recordingStore.read(id);
      await assertAnchorInProject(db, payload.meta.anchorId, projectId);
      return payload;
    } catch (error) {
      return respondWithAnchorTerminalError(reply, error);
    }
  });
}

export type AnchorTerminalClientFrameAction =
  | { type: "send"; payload: unknown }
  | { type: "close" }
  | { type: "viewport"; cols: number; rows: number; active: boolean }
  | { type: "request_write" }
  | { type: "release_write" }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ignore" };

export function evaluateAnchorTerminalClientFrame(raw: Buffer | string): AnchorTerminalClientFrameAction {
  const parsed = parseFrame(raw);
  if (!parsed || typeof parsed.type !== "string") {
    return { type: "send", payload: { type: "error", code: "BAD_FRAME", message: "无效 JSON 帧" } };
  }
  switch (parsed.type) {
    case "ping":
      return { type: "send", payload: { type: "pong" } };
    case "close":
      return { type: "close" };
    case "viewport":
      return parseViewportAction(parsed);
    case "request_write":
      return { type: "request_write" };
    case "release_write":
      return { type: "release_write" };
    case "in":
      return typeof parsed.data === "string"
        ? { type: "input", data: parsed.data }
        : { type: "send", payload: { type: "error", code: "BAD_FRAME", message: "in.data must be a string" } };
    case "resize":
      return parseResizeAction(parsed);
    case "write":
      return {
        type: "send",
        payload: {
          type: "error",
          code: "READ_ONLY",
          message: "anchor terminal MVP 仅支持只读 attach"
        }
      };
    default:
      return { type: "ignore" };
  }
}

function parseViewportAction(frame: { cols?: unknown; rows?: unknown; active?: unknown }): AnchorTerminalClientFrameAction {
  const cols = parseViewportSize(frame.cols);
  const rows = parseViewportSize(frame.rows);
  if (cols === null || rows === null) {
    return { type: "ignore" };
  }
  return {
    type: "viewport",
    cols: clamp(Math.round(cols), 60, 300),
    rows: clamp(Math.round(rows), 10, 100),
    active: frame.active === false ? false : true
  };
}

async function resolveAnchor(db: PrismaClient, anchorId: string) {
  const row = await db.anchorAllocation.findUnique({
    where: {
      anchorId
    }
  });
  if (!row || row.state === "destroyed") {
    return null;
  }
  const projectId = await resolveAnchorProjectId(db, row);
  if (!projectId) {
    return null;
  }
  return {
    anchorId: row.anchorId,
    anchorPath: row.anchorPath,
    taskId: row.subjectId,
    state: row.state
  };
}

async function assertAnchorInProject(db: PrismaClient, anchorId: string, projectId: string): Promise<void> {
  const row = await db.anchorAllocation.findUnique({
    where: {
      anchorId
    }
  });
  if (!row || row.state === "destroyed") {
    throw new AnchorTerminalError("ANCHOR_NOT_FOUND", "anchor 已销毁或不存在", 404);
  }

  const actualProjectId = await resolveAnchorProjectId(db, row);
  if (!actualProjectId) {
    throw new AnchorTerminalError("ANCHOR_SCOPE_UNKNOWN", "anchor 项目归属不可确认", 404);
  }
  if (actualProjectId !== projectId) {
    throw new AnchorTerminalError("ANCHOR_SCOPE_FORBIDDEN", "anchor 不属于当前项目", 403);
  }
}

async function resolveAnchorProjectId(
  db: PrismaClient,
  row: { projectId: string | null; subjectType: string; subjectId: string }
): Promise<string | null> {
  if (row.projectId) {
    return row.projectId;
  }
  if (row.subjectType === "requirement") {
    const requirement = await db.requirement.findUnique({
      where: { id: row.subjectId },
      select: { projectId: true }
    });
    return requirement?.projectId ?? null;
  }
  if (row.subjectType === "subtask" || row.subjectType === "task") {
    const task = await db.task.findUnique({
      where: { id: row.subjectId },
      select: { projectId: true }
    });
    return task?.projectId ?? null;
  }
  return null;
}

async function filterRecordingsForProject(
  db: PrismaClient,
  metas: AnchorTerminalRecordingMeta[],
  projectId: string
): Promise<AnchorTerminalRecordingMeta[]> {
  const filtered: AnchorTerminalRecordingMeta[] = [];
  for (const meta of metas) {
    try {
      await assertAnchorInProject(db, meta.anchorId, projectId);
      filtered.push(meta);
    } catch {
      // Missing, orphaned, and cross-project recordings are not visible in a scoped list.
    }
  }
  return filtered;
}

function projectIdFromQuery(query: unknown): string | null {
  const value = query && typeof query === "object"
    ? (query as { projectId?: unknown; project_id?: unknown }).projectId ??
      (query as { projectId?: unknown; project_id?: unknown }).project_id
    : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function respondWithAnchorTerminalError(reply: FastifyReply, error: unknown) {
  if (error instanceof AnchorTerminalError) {
    reply.status(error.statusCode);
    return { code: error.code, message: error.message };
  }
  if (error instanceof AiCliError) {
    reply.status(error.statusCode);
    return { code: error.code, message: error.message };
  }
  reply.status(500);
  return { code: "INTERNAL", message: errorMessage(error) };
}

function parseResizeAction(frame: { cols?: unknown; rows?: unknown }): AnchorTerminalClientFrameAction {
  const cols = parseViewportSize(frame.cols);
  const rows = parseViewportSize(frame.rows);
  if (cols === null || rows === null) {
    return { type: "ignore" };
  }
  return {
    type: "resize",
    cols: clamp(Math.round(cols), 60, 300),
    rows: clamp(Math.round(rows), 10, 100)
  };
}

function parseFrame(
  raw: Buffer | string
): { type?: string; cols?: unknown; rows?: unknown; active?: unknown; data?: unknown } | null {
  try {
    const parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as { type?: string; cols?: unknown; rows?: unknown; active?: unknown; data?: unknown })
      : null;
  } catch {
    return null;
  }
}

function parseViewportSize(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sendJson(socket: { send: (data: string) => void }, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // socket already closed
  }
}

function sendErrorAndClose(
  socket: { send: (data: string) => void; close: (code?: number, reason?: string) => void },
  code: string,
  message: string,
  closeCode: number
): void {
  try {
    socket.send(JSON.stringify({ type: "error", code, message }));
    socket.close(closeCode, message.slice(0, 120));
  } catch {
    // ignore
  }
}

function errorCode(error: unknown): string {
  if (error instanceof AnchorTerminalError || error instanceof AiCliError) {
    return error.code;
  }
  return "INTERNAL";
}

function wsCloseCode(error: unknown): number {
  if (error instanceof AnchorTerminalError || error instanceof AiCliError) {
    return error.statusCode >= 400 && error.statusCode < 500 ? 1008 : 1011;
  }
  return 1011;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
