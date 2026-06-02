import { resolveApiBaseUrl } from "./console-api.js";
import {
  parseSlotTerminalServerFrame,
  type SlotTerminalClientFrame,
  type SlotTerminalPaneRole,
  type SlotTerminalReadyDescriptor,
  type SlotTerminalSnapshotFrame
} from "../types/slot-terminal.js";

const SOCKET_OPEN = 1;

export type SlotTerminalClientStatus = "connecting" | "open" | "closed" | "error";

export interface SlotTerminalClientCallbacks {
  onReady?: (descriptor: SlotTerminalReadyDescriptor) => void;
  onFrame?: (frame: SlotTerminalSnapshotFrame) => void;
  onError?: (code: string, message: string) => void;
  onStatusChange?: (status: SlotTerminalClientStatus) => void;
}

export interface SlotTerminalClientOptions {
  projectId: string;
  requirementId: string;
  pane: SlotTerminalPaneRole;
  webSocketFactory?: SlotTerminalWebSocketFactory;
  callbacks?: SlotTerminalClientCallbacks;
}

export interface SlotTerminalWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", handler: (event: Event | MessageEvent) => void): void;
}

export type SlotTerminalWebSocketFactory = new (url: string) => SlotTerminalWebSocketLike;

export function createSlotTerminalClient(options: SlotTerminalClientOptions) {
  const callbacks = options.callbacks ?? {};
  const webSocketFactory = options.webSocketFactory ?? WebSocket;
  const pendingFrames: SlotTerminalClientFrame[] = [];
  let status: SlotTerminalClientStatus = "connecting";
  let closedByUser = false;
  let socket: SlotTerminalWebSocketLike | null = null;

  const setStatus = (next: SlotTerminalClientStatus) => {
    if (status === next) {
      return;
    }
    status = next;
    callbacks.onStatusChange?.(next);
  };

  const sendFrame = (frame: SlotTerminalClientFrame) => {
    if (socket?.readyState === SOCKET_OPEN) {
      socket.send(JSON.stringify(frame));
      return;
    }
    pendingFrames.push(frame);
  };

  const flushPending = () => {
    while (pendingFrames.length > 0 && socket?.readyState === SOCKET_OPEN) {
      const frame = pendingFrames.shift();
      if (frame) {
        socket.send(JSON.stringify(frame));
      }
    }
  };

  try {
    socket = new webSocketFactory(buildSlotTerminalWsUrl(options));
  } catch (error) {
    setStatus("error");
    callbacks.onError?.("WS_OPEN_FAILED", error instanceof Error ? error.message : "slot terminal websocket failed");
  }

  socket?.addEventListener("open", () => {
    setStatus("open");
    flushPending();
  });

  socket?.addEventListener("message", (event) => {
    const frame = parseSlotTerminalServerFrame((event as MessageEvent).data as string | ArrayBuffer | Blob);
    if (!frame) {
      return;
    }
    switch (frame.type) {
      case "ready":
        callbacks.onReady?.(frame.descriptor);
        return;
      case "frame":
        callbacks.onFrame?.(frame);
        return;
      case "error":
        callbacks.onError?.(frame.code, frame.message);
        return;
      case "pong":
        return;
    }
  });

  socket?.addEventListener("close", () => {
    setStatus(closedByUser ? "closed" : "error");
  });
  socket?.addEventListener("error", () => {
    setStatus("error");
  });

  return {
    sendVisibility(state: "hidden" | "visible"): void {
      sendFrame({ type: "visibility", state });
    },
    sendActive(active: boolean): void {
      sendFrame({ type: "active", active });
    },
    sendHint(hint: { visible?: boolean; active?: boolean }): void {
      sendFrame({ type: "hint", ...hint });
    },
    sendInput(data: string): void {
      sendFrame({ type: "input", data });
    },
    sendPaste(data: string): void {
      sendFrame({ type: "paste", data });
    },
    ping(): void {
      sendFrame({ type: "ping" });
    },
    requestClose(): void {
      sendFrame({ type: "close" });
    },
    close(): void {
      closedByUser = true;
      try {
        socket?.close(1000, "client close");
      } catch {
        // ignore
      }
      setStatus("closed");
    },
    status(): SlotTerminalClientStatus {
      return status;
    }
  };
}

export function buildSlotTerminalWsUrl(input: {
  projectId: string;
  requirementId: string;
  pane: SlotTerminalPaneRole;
}): string {
  const params = new URLSearchParams({
    projectId: input.projectId,
    requirementId: input.requirementId,
    pane: input.pane
  });
  const base = resolveApiBaseUrl();
  if (base) {
    return `${base.replace(/^http/, "ws")}/api/slot-terminal/ws?${params.toString()}`;
  }
  const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const host = typeof window !== "undefined" ? window.location.host : "127.0.0.1:3030";
  return `${proto}://${host}/api/slot-terminal/ws?${params.toString()}`;
}

export type SlotTerminalClient = ReturnType<typeof createSlotTerminalClient>;
