import type { FastifyInstance } from "fastify";

import { AI_CLI_ERROR_CODES, AiCliError } from "./ai-cli.errors.js";
import { assertLocalRequest } from "./ai-cli.guard.js";
import { sharedPtyManager } from "./ai-cli.pty.js";
import type { PtyManager } from "./ai-cli.pty.js";

/**
 * WebSocket 协议（前端 ↔ server）：
 *  C → S: { type: "in",     data: string }
 *         { type: "resize", cols: number, rows: number }
 *         { type: "ping" }
 *         { type: "close" }
 *  S → C: { type: "ready",  descriptor }   首次成功 attach
 *         { type: "out",    data: string }
 *         { type: "exit",   code: number, signal: string|null }
 *         { type: "pong" }
 *         { type: "error",  code, message }
 *
 * 协议帧用 JSON。out 走 utf-8 文本；node-pty 输出在 Windows 下可能含部分 UTF-16
 * 字节，但 conpty 默认走 codepage 65001，前端 xterm.js 直接 write(string) 即可。
 */
export interface RegisterWsOptions {
  manager?: PtyManager;
}

const PING_TIMEOUT_MS = 60 * 1000;

export async function registerAiCliWs(
  app: FastifyInstance,
  options: RegisterWsOptions = {}
): Promise<void> {
  const manager = options.manager ?? sharedPtyManager;

  app.get("/ws/ai-cli/:sessionId", { websocket: true }, (socket, request) => {
    try {
      assertLocalRequest(request);
    } catch (error) {
      sendErrorAndClose(socket, AI_CLI_ERROR_CODES.WS_UNAUTHORIZED, errorMessage(error), 1008);
      return;
    }

    const { sessionId } = request.params as { sessionId: string };
    let attached;
    try {
      attached = manager.attach(sessionId, socket);
    } catch (error) {
      const code = error instanceof AiCliError ? error.code : AI_CLI_ERROR_CODES.SESSION_NOT_FOUND;
      sendErrorAndClose(socket, code, errorMessage(error), 1011);
      return;
    }

    let lastPingAt = Date.now();
    const pingTimer = setInterval(() => {
      if (Date.now() - lastPingAt > PING_TIMEOUT_MS) {
        try {
          socket.close(1001, "ping timeout");
        } catch {
          // ignore
        }
      }
    }, 15 * 1000);

    const onOutput = (event: { sessionId: string; data: string }) => {
      if (event.sessionId !== sessionId) {
        return;
      }
      sendJson(socket, { type: "out", data: event.data });
    };
    const onExit = (event: { sessionId: string; code: number; signal: string | null }) => {
      if (event.sessionId !== sessionId) {
        return;
      }
      sendJson(socket, { type: "exit", code: event.code, signal: event.signal });
    };

    attached.emitter.on("output", onOutput);
    attached.emitter.on("exit", onExit);

    sendJson(socket, { type: "ready", descriptor: attached.descriptor });
    if (attached.bufferTail.length > 0) {
      sendJson(socket, { type: "out", data: attached.bufferTail });
    }

    socket.on("message", (raw: Buffer | string) => {
      lastPingAt = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
      } catch {
        sendJson(socket, { type: "error", code: "BAD_FRAME", message: "无效 JSON 帧" });
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      const frame = parsed as { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
      switch (frame.type) {
        case "in":
          if (typeof frame.data === "string") {
            manager.write(sessionId, frame.data);
          }
          return;
        case "resize":
          if (typeof frame.cols === "number" && typeof frame.rows === "number") {
            manager.resize(sessionId, frame.cols, frame.rows);
          }
          return;
        case "ping":
          sendJson(socket, { type: "pong" });
          return;
        case "close":
          manager.kill(sessionId, "USER_CLOSE");
          try {
            socket.close(1000, "client requested close");
          } catch {
            // ignore
          }
          return;
        default:
          return;
      }
    });

    socket.on("close", () => {
      clearInterval(pingTimer);
      attached.emitter.off("output", onOutput);
      attached.emitter.off("exit", onExit);
      manager.detach(sessionId, socket);
    });
  });
}

function sendJson(socket: { send: (data: string) => void }, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // 已断开
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
