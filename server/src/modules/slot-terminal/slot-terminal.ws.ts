import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import { assertTargetBelongsTo } from "./slot-terminal.guard.js";
import {
  isSlotTerminalNotFoundError,
  isSlotTerminalTargetForbiddenError
} from "./slot-terminal.errors.js";
import {
  buildSlotTerminalTmuxSocketPath,
  isSlotTerminalRole,
  PrismaSlotTerminalStore,
  SlotTerminalService,
  type SlotTerminalRole,
  type SlotTerminalStore
} from "./slot-terminal.service.js";
import {
  SLOT_TERMINAL_ACTIVE_FRAME_INTERVAL_MS,
  SLOT_TERMINAL_IDLE_FRAME_INTERVAL_MS,
  SlotTerminalFramePump,
  TmuxSlotTerminalFrameCapture,
  type SlotTerminalFrameCaptureBackend,
  type SlotTerminalPollingHint,
  type SlotTerminalVisibility
} from "./slot-terminal.frame-stream.js";
import {
  SlotTerminalInputAuditWriter,
  TmuxSlotTerminalInputWriter,
  type SlotTerminalInputAuditSink,
  type SlotTerminalInputWriterBackend
} from "./slot-terminal.input.js";

export const SLOT_TERMINAL_INPUT_MAX_BYTES = 64 * 1024;

export type SlotTerminalWebSocketService = Pick<
  SlotTerminalService,
  "resolveRequirementTerminal" | "assertTargetBelongsTo"
>;

export type SlotTerminalWebSocketDependencies = {
  prismaClient?: PrismaClient;
  store?: SlotTerminalStore;
  service?: SlotTerminalWebSocketService;
  capture?: SlotTerminalFrameCaptureBackend;
  inputWriter?: SlotTerminalInputWriterBackend;
  auditSink?: SlotTerminalInputAuditSink;
  activeIntervalMs?: number;
  idleIntervalMs?: number;
  allowedOrigins?: string[];
  inputMaxBytes?: number;
};

export type SlotTerminalClientFrameAction =
  | { type: "send"; payload: unknown }
  | { type: "close" }
  | { type: "hint"; visibility?: SlotTerminalVisibility; active?: boolean }
  | { type: "input"; data: string }
  | { type: "paste"; data: string }
  | { type: "ignore" };

type SlotTerminalSubscription = {
  slotId: string;
  role: SlotTerminalRole;
  target: string;
  socketPath: string;
};

export async function registerSlotTerminalWebSocketRoutes(
  app: FastifyInstance,
  dependencies: SlotTerminalWebSocketDependencies = {}
): Promise<void> {
  const store = dependencies.store ?? new PrismaSlotTerminalStore(dependencies.prismaClient ?? prisma);
  const service = dependencies.service ?? new SlotTerminalService({ store });
  const capture = dependencies.capture ?? new TmuxSlotTerminalFrameCapture();
  const inputWriter = dependencies.inputWriter ?? new TmuxSlotTerminalInputWriter();
  const auditSink = dependencies.auditSink ?? new SlotTerminalInputAuditWriter();
  const activeIntervalMs = dependencies.activeIntervalMs ?? SLOT_TERMINAL_ACTIVE_FRAME_INTERVAL_MS;
  const idleIntervalMs = dependencies.idleIntervalMs ?? SLOT_TERMINAL_IDLE_FRAME_INTERVAL_MS;
  const allowedOrigins = dependencies.allowedOrigins ?? getDefaultAllowedOrigins();
  const inputMaxBytes = dependencies.inputMaxBytes ?? SLOT_TERMINAL_INPUT_MAX_BYTES;

  app.get("/api/slot-terminal/ws", { websocket: true }, (socket, request) => {
    if (!isSlotTerminalOriginAllowed(request.headers.origin, allowedOrigins)) {
      sendErrorAndClose(socket, "FORBIDDEN", "websocket origin is not allowed", 1008);
      return;
    }

    const { projectId, requirementId, pane } = request.query as {
      projectId?: string;
      requirementId?: string;
      pane?: string;
    };

    if (!projectId || !requirementId || !pane) {
      sendErrorAndClose(socket, "BAD_REQUEST", "projectId, requirementId, and pane are required", 1008);
      return;
    }
    if (!isSlotTerminalRole(pane)) {
      sendErrorAndClose(socket, "BAD_REQUEST", "pane must be claude or codex", 1008);
      return;
    }

    let pump: SlotTerminalFramePump | null = null;
    let subscription: SlotTerminalSubscription | null = null;
    let pendingHint: SlotTerminalPollingHint | null = null;
    let inputQueue = Promise.resolve();
    let closed = false;
    const closePump = () => {
      if (closed) {
        return;
      }
      closed = true;
      pump?.stop();
    };

    void (async () => {
      try {
        const resolvedSubscription = await resolveSlotTerminalSubscription({
          store,
          service,
          projectId,
          requirementId,
          role: pane
        });
        subscription = resolvedSubscription;

        if (closed) {
          return;
        }

        pump = new SlotTerminalFramePump({
          capture,
          target: resolvedSubscription.target,
          socketPath: resolvedSubscription.socketPath,
          activeIntervalMs,
          idleIntervalMs,
          onFrame: (frame) => {
            sendJson(socket, {
              type: "frame",
              data: frame.data,
              cols: frame.cols,
              rows: frame.rows,
              generation: frame.generation,
              initial: frame.initial
            });
          },
          onError: (error) => {
            sendErrorAndClose(socket, "CAPTURE_FAILED", errorMessage(error), 1011);
          }
        });

        if (pendingHint) {
          pump.configureHint(pendingHint);
          pendingHint = null;
        }

        sendJson(socket, {
          type: "ready",
          descriptor: {
            projectId,
            requirementId,
            slotId: resolvedSubscription.slotId,
            pane,
            target: resolvedSubscription.target,
            source: "slot-terminal",
            readonly: false,
            polling: {
              activeMs: activeIntervalMs,
              idleMs: idleIntervalMs,
              hidden: "paused"
            }
          }
        });
        await pump.start();
      } catch (error) {
        sendErrorAndClose(socket, errorCode(error), errorMessage(error), closeCode(error));
      }
    })();

    socket.on("message", (raw: Buffer | string) => {
      const action = evaluateSlotTerminalClientFrame(raw);
      if (action.type === "send") {
        sendJson(socket, action.payload);
      } else if (action.type === "close") {
        closePump();
        try {
          socket.close(1000, "client requested close");
        } catch {
          // ignore
        }
      } else if (action.type === "hint") {
        if (pump) {
          void applySlotTerminalHint(pump, action);
        } else {
          pendingHint = mergeSlotTerminalHint(pendingHint, action);
        }
      } else if (action.type === "input" || action.type === "paste") {
        const activeSubscription = subscription;
        if (!activeSubscription) {
          sendJson(socket, { type: "error", code: "NOT_READY", message: "slot terminal websocket is not ready" });
          return;
        }
        const mode = action.type;
        const data = action.data;
        inputQueue = inputQueue
          .then(async () => {
            await applySlotTerminalInput({
              service,
              inputWriter,
              auditSink,
              projectId,
              requirementId,
              subscription: activeSubscription,
              data,
              remoteAddr: request.ip || request.socket.remoteAddress || "unknown",
              inputMaxBytes,
              mode
            });
          })
          .catch((error) => {
            sendJson(socket, { type: "error", code: errorCode(error), message: errorMessage(error) });
          });
      }
    });

    socket.on("close", closePump);
  });
}

export function evaluateSlotTerminalClientFrame(raw: Buffer | string): SlotTerminalClientFrameAction {
  const parsed = parseFrame(raw);
  if (!parsed || typeof parsed.type !== "string") {
    return { type: "send", payload: { type: "error", code: "BAD_FRAME", message: "invalid JSON frame" } };
  }
  switch (parsed.type) {
    case "ping":
      return { type: "send", payload: { type: "pong" } };
    case "close":
      return { type: "close" };
    case "visibility":
    case "active":
    case "viewport":
    case "hint":
      return parseHintAction(parsed);
    case "in":
    case "input":
    case "write":
      return parseInputAction(parsed);
    case "paste":
      return parsePasteAction(parsed);
    case "resize":
    case "request_write":
    case "release_write":
      return {
        type: "send",
        payload: {
          type: "error",
          code: "READ_ONLY",
          message: "slot terminal websocket is read-only"
        }
      };
    default:
      return { type: "ignore" };
  }
}

async function applySlotTerminalHint(pump: SlotTerminalFramePump, hint: SlotTerminalPollingHint): Promise<void> {
  if (hint.visibility === "hidden") {
    await pump.setVisibility("hidden");
  }
  if (typeof hint.active === "boolean") {
    await pump.setActive(hint.active);
  }
  if (hint.visibility === "visible") {
    await pump.setVisibility("visible");
  }
}

function mergeSlotTerminalHint(
  previous: SlotTerminalPollingHint | null,
  next: SlotTerminalPollingHint
): SlotTerminalPollingHint {
  return {
    visibility: next.visibility ?? previous?.visibility,
    active: typeof next.active === "boolean" ? next.active : previous?.active
  };
}

async function applySlotTerminalInput(input: {
  service: SlotTerminalWebSocketService;
  inputWriter: SlotTerminalInputWriterBackend;
  auditSink: SlotTerminalInputAuditSink;
  projectId: string;
  requirementId: string;
  subscription: SlotTerminalSubscription;
  data: string;
  remoteAddr: string;
  inputMaxBytes: number;
  mode?: "input" | "paste";
}): Promise<void> {
  if (!input.data) {
    return;
  }
  const bytes = Buffer.byteLength(input.data, "utf8");
  if (bytes > input.inputMaxBytes) {
    await input.auditSink.recordInput({
      projectId: input.projectId,
      requirementId: input.requirementId,
      slotId: input.subscription.slotId,
      pane: input.subscription.role,
      target: input.subscription.target,
      remoteAddr: input.remoteAddr,
      data: input.data,
      commandCount: 0,
      outcome: "rejected",
      rejectionCode: "INPUT_TOO_LARGE",
      rejectionReason: `input.data exceeds ${input.inputMaxBytes} bytes`
    });
    throw new SlotTerminalInputTooLargeError(`input.data exceeds ${input.inputMaxBytes} bytes`);
  }
  let checked;
  try {
    checked = await assertTargetBelongsTo(
      input.requirementId,
      input.subscription.slotId,
      input.subscription.role,
      input.subscription.target,
      { service: input.service }
    );
  } catch (error) {
    if (isSlotTerminalTargetForbiddenError(error)) {
      await input.auditSink.recordInput({
        projectId: input.projectId,
        requirementId: input.requirementId,
        slotId: input.subscription.slotId,
        pane: input.subscription.role,
        target: input.subscription.target,
        remoteAddr: input.remoteAddr,
        data: input.data,
        commandCount: 0,
        outcome: "forbidden",
        rejectionCode: "FORBIDDEN",
        rejectionReason: errorMessage(error)
      });
    }
    throw error;
  }
  const write = { target: checked.target, socketPath: input.subscription.socketPath, data: input.data };
  const result =
    input.mode === "paste"
      ? await input.inputWriter.sendPaste(write)
      : await input.inputWriter.sendInput(write);
  await input.auditSink.recordInput({
    projectId: input.projectId,
    requirementId: input.requirementId,
    slotId: input.subscription.slotId,
    pane: input.subscription.role,
    target: checked.target,
    remoteAddr: input.remoteAddr,
    data: input.data,
    commandCount: result.commandCount,
    outcome: "accepted"
  });
}

async function resolveSlotTerminalSubscription(input: {
  store: Pick<SlotTerminalStore, "findProject">;
  service: SlotTerminalWebSocketService;
  projectId: string;
  requirementId: string;
  role: SlotTerminalRole;
}): Promise<SlotTerminalSubscription> {
  const [project, descriptor] = await Promise.all([
    input.store.findProject(input.projectId),
    input.service.resolveRequirementTerminal({
      projectId: input.projectId,
      requirementId: input.requirementId
    })
  ]);
  if (!project) {
    throw new Error("slot terminal project not found");
  }

  const pane = descriptor.panes.find((candidate) => candidate.role === input.role);
  if (!pane) {
    throw new Error("slot terminal pane not found");
  }

  const checked = await assertTargetBelongsTo(input.requirementId, descriptor.slotId, input.role, pane.target, {
    service: input.service
  });

  return {
    slotId: descriptor.slotId,
    role: input.role,
    target: checked.target,
    socketPath: buildSlotTerminalTmuxSocketPath(project.localPath)
  };
}

function parseInputAction(frame: { data?: unknown }): SlotTerminalClientFrameAction {
  if (typeof frame.data !== "string") {
    return { type: "send", payload: { type: "error", code: "BAD_FRAME", message: "input.data must be a string" } };
  }
  return {
    type: "input",
    data: frame.data
  };
}

function parsePasteAction(frame: { data?: unknown }): SlotTerminalClientFrameAction {
  if (typeof frame.data !== "string") {
    return { type: "send", payload: { type: "error", code: "BAD_FRAME", message: "paste.data must be a string" } };
  }
  return {
    type: "paste",
    data: frame.data
  };
}

function parseHintAction(frame: {
  type?: unknown;
  visibility?: unknown;
  state?: unknown;
  hidden?: unknown;
  visible?: unknown;
  active?: unknown;
}): SlotTerminalClientFrameAction {
  const visibility = normalizeVisibility(frame.visibility ?? frame.state, frame.hidden, frame.visible);
  const active = typeof frame.active === "boolean" ? frame.active : undefined;
  if (!visibility && typeof active !== "boolean") {
    return { type: "ignore" };
  }
  return {
    type: "hint",
    visibility,
    active
  };
}

function normalizeVisibility(
  value: unknown,
  hidden: unknown,
  visible: unknown
): SlotTerminalVisibility | undefined {
  if (value === "hidden" || value === "visible") {
    return value;
  }
  if (typeof hidden === "boolean") {
    return hidden ? "hidden" : "visible";
  }
  if (typeof visible === "boolean") {
    return visible ? "visible" : "hidden";
  }
  return undefined;
}

function parseFrame(raw: Buffer | string): {
  type?: unknown;
  visibility?: unknown;
  state?: unknown;
  hidden?: unknown;
  visible?: unknown;
  active?: unknown;
  data?: unknown;
} | null {
  try {
    const parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as {
          type?: unknown;
          visibility?: unknown;
          state?: unknown;
          hidden?: unknown;
          visible?: unknown;
          active?: unknown;
          data?: unknown;
        })
      : null;
  } catch {
    return null;
  }
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
  if (error instanceof SlotTerminalInputTooLargeError) {
    return "INPUT_TOO_LARGE";
  }
  if (isSlotTerminalTargetForbiddenError(error)) {
    return "FORBIDDEN";
  }
  if (isSlotTerminalNotFoundError(error)) {
    return "NOT_FOUND";
  }
  return "INTERNAL";
}

function closeCode(error: unknown): number {
  if (isSlotTerminalTargetForbiddenError(error) || isSlotTerminalNotFoundError(error)) {
    return 1008;
  }
  return 1011;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export function isSlotTerminalOriginAllowed(origin: unknown, allowedOrigins: readonly string[]): boolean {
  if (typeof origin !== "string") {
    return false;
  }
  const normalizedOrigin = origin.trim();
  if (!normalizedOrigin) {
    return false;
  }
  return allowedOrigins.some((allowed) => allowed.trim() === normalizedOrigin);
}

function getDefaultAllowedOrigins(): string[] {
  return (process.env.CCB_CORS_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

class SlotTerminalInputTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotTerminalInputTooLargeError";
  }
}
