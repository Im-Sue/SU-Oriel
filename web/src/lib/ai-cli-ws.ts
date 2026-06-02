import { resolveApiBaseUrl } from "./console-api.js";

export interface PtyClientCallbacks {
  onReady?: (descriptor: unknown) => void;
  onOutput?: (data: string) => void;
  onExit?: (code: number, signal: string | null) => void;
  onError?: (code: string, message: string) => void;
  onStatusChange?: (status: PtyClientStatus) => void;
}

export type PtyClientStatus = "connecting" | "open" | "reconnecting" | "closed" | "error";

const PING_INTERVAL_MS = 20_000;
const MAX_RETRY = 5;

interface InternalState {
  status: PtyClientStatus;
  attempts: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closedByUser: boolean;
}

/**
 * 极简 PTY WebSocket 客户端：
 * - 自动指数退避重连（最多 5 次），重连后 server 用 sessionId 续上同一进程
 * - 20s 心跳；server 60s 没收到心跳会主动断
 * - 上层用 send / sendResize / sendInput 写入；接收数据走回调
 */
export function createPtyClient(sessionId: string, callbacks: PtyClientCallbacks = {}) {
  const state: InternalState = {
    status: "connecting",
    attempts: 0,
    pingTimer: null,
    reconnectTimer: null,
    closedByUser: false
  };

  let socket: WebSocket | null = null;

  const setStatus = (next: PtyClientStatus) => {
    if (state.status !== next) {
      state.status = next;
      callbacks.onStatusChange?.(next);
    }
  };

  const buildUrl = () => {
    const base = resolveApiBaseUrl();
    if (base) {
      return `${base.replace(/^http/, "ws")}/ws/ai-cli/${sessionId}`;
    }
    const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
    const host = typeof window !== "undefined" ? window.location.host : "127.0.0.1:3030";
    return `${proto}://${host}/ws/ai-cli/${sessionId}`;
  };

  const cleanupTimers = () => {
    if (state.pingTimer) {
      clearInterval(state.pingTimer);
      state.pingTimer = null;
    }
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (state.closedByUser || state.attempts >= MAX_RETRY) {
      setStatus("closed");
      return;
    }
    state.attempts += 1;
    setStatus("reconnecting");
    const delay = Math.min(1000 * 2 ** state.attempts, 8000);
    state.reconnectTimer = setTimeout(() => {
      open();
    }, delay);
  };

  const open = () => {
    setStatus("connecting");
    cleanupTimers();
    try {
      socket = new WebSocket(buildUrl());
    } catch (error) {
      callbacks.onError?.("WS_OPEN_FAILED", error instanceof Error ? error.message : "WS 创建失败");
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", () => {
      state.attempts = 0;
      setStatus("open");
      state.pingTimer = setInterval(() => {
        try {
          socket?.send(JSON.stringify({ type: "ping" }));
        } catch {
          // ignore
        }
      }, PING_INTERVAL_MS);
    });

    socket.addEventListener("message", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data));
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      const frame = parsed as { type?: string; data?: unknown; code?: unknown; signal?: unknown; descriptor?: unknown; message?: unknown };
      switch (frame.type) {
        case "ready":
          callbacks.onReady?.(frame.descriptor);
          return;
        case "out":
          if (typeof frame.data === "string") {
            callbacks.onOutput?.(frame.data);
          }
          return;
        case "exit":
          callbacks.onExit?.(typeof frame.code === "number" ? frame.code : -1, typeof frame.signal === "string" ? frame.signal : null);
          return;
        case "error":
          callbacks.onError?.(
            typeof frame.code === "string" ? frame.code : "ERROR",
            typeof frame.message === "string" ? frame.message : "未知错误"
          );
          return;
        case "pong":
        default:
          return;
      }
    });

    socket.addEventListener("close", (event) => {
      cleanupTimers();
      if (state.closedByUser) {
        setStatus("closed");
        return;
      }
      if (event.code === 1008 || event.code === 1011) {
        // 鉴权失败 / session 不存在：不再重连
        setStatus("closed");
        return;
      }
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // 错误事件之后通常会接 close，让 close 决定是否重连
    });
  };

  open();

  return {
    sendInput(data: string): void {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "in", data }));
      }
    },
    sendResize(cols: number, rows: number): void {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    },
    requestClose(): void {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "close" }));
      }
    },
    close(): void {
      state.closedByUser = true;
      cleanupTimers();
      try {
        socket?.close(1000, "client close");
      } catch {
        // ignore
      }
    },
    status(): PtyClientStatus {
      return state.status;
    }
  };
}

export type PtyClient = ReturnType<typeof createPtyClient>;
