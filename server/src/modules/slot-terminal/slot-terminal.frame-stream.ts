import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SLOT_TERMINAL_ACTIVE_FRAME_INTERVAL_MS = 150;
export const SLOT_TERMINAL_IDLE_FRAME_INTERVAL_MS = 1_000;
const SLOT_TERMINAL_DIMENSIONS_CACHE_MS = 1_000;

export type SlotTerminalVisibility = "visible" | "hidden";

export type SlotTerminalPollingHint = {
  visibility?: SlotTerminalVisibility;
  active?: boolean;
};

export type SlotTerminalFrame = {
  data: string;
  cols: number;
  rows: number;
  generation: number;
  initial: boolean;
  mouseAny: boolean;
  mouseSgr: boolean;
};

export type SlotTerminalCaptureInput = {
  target: string;
  socketPath?: string;
  initial?: boolean;
};

export type SlotTerminalPaneDimensions = {
  cols: number;
  rows: number;
};

export type SlotTerminalPaneMouseState = {
  mouseAny: boolean;
  mouseSgr: boolean;
};

export type SlotTerminalExecFileProcess = (
  command: string,
  args: string[]
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface SlotTerminalFrameCaptureBackend {
  capturePane(input: SlotTerminalCaptureInput): Promise<string>;
  getPaneDimensions?(input: SlotTerminalCaptureInput): Promise<SlotTerminalPaneDimensions>;
  getPaneMouseState?(input: SlotTerminalCaptureInput): Promise<SlotTerminalPaneMouseState>;
}

export class TmuxSlotTerminalFrameCapture implements SlotTerminalFrameCaptureBackend {
  private readonly tmuxCommand: string;
  private readonly execFileProcess: SlotTerminalExecFileProcess;
  private readonly dimensionsCache = new Map<string, { dimensions: SlotTerminalPaneDimensions; checkedAt: number }>();

  constructor(options: { tmuxCommand?: string; execFileProcess?: SlotTerminalExecFileProcess } = {}) {
    this.tmuxCommand = options.tmuxCommand ?? "tmux";
    this.execFileProcess =
      options.execFileProcess ??
      (async (command, args) => {
        const result = await execFileAsync(command, args);
        return {
          stdout: result.stdout,
          stderr: result.stderr
        };
      });
  }

  async capturePane(input: SlotTerminalCaptureInput): Promise<string> {
    const args = [
      ...(input.socketPath ? ["-S", input.socketPath] : []),
      "capture-pane",
      ...(input.initial ? ["-S", "-2000"] : []),
      "-p",
      "-e",
      "-t",
      input.target
    ];
    const { stdout } = await this.execFileProcess(this.tmuxCommand, args);
    return String(stdout);
  }

  async getPaneDimensions(input: SlotTerminalCaptureInput): Promise<SlotTerminalPaneDimensions> {
    const cacheKey = `${input.socketPath ?? ""}\u0000${input.target}`;
    const cached = this.dimensionsCache.get(cacheKey);
    if (cached && Date.now() - cached.checkedAt < SLOT_TERMINAL_DIMENSIONS_CACHE_MS) {
      return cached.dimensions;
    }
    const args = [
      ...(input.socketPath ? ["-S", input.socketPath] : []),
      "display-message",
      "-p",
      "-t",
      input.target,
      "#{pane_width} #{pane_height}"
    ];
    const { stdout } = await this.execFileProcess(this.tmuxCommand, args);
    const dimensions = parsePaneDimensions(String(stdout));
    this.dimensionsCache.set(cacheKey, { dimensions, checkedAt: Date.now() });
    return dimensions;
  }

  async getPaneMouseState(input: SlotTerminalCaptureInput): Promise<SlotTerminalPaneMouseState> {
    const args = [
      ...(input.socketPath ? ["-S", input.socketPath] : []),
      "display-message",
      "-p",
      "-t",
      input.target,
      "#{mouse_any_flag} #{mouse_sgr_flag}"
    ];
    const { stdout } = await this.execFileProcess(this.tmuxCommand, args);
    return parsePaneMouseState(String(stdout));
  }
}

export class SlotTerminalFramePump {
  private readonly capture: SlotTerminalFrameCaptureBackend;
  private readonly target: string;
  private readonly socketPath: string | undefined;
  private readonly activeIntervalMs: number;
  private readonly idleIntervalMs: number;
  private readonly onFrame: (frame: SlotTerminalFrame) => void;
  private readonly onError: (error: unknown) => void;
  private visibility: SlotTerminalVisibility = "visible";
  private active = true;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private closed = false;
  private lastFrameKey: string | null = null;
  private generation = 0;

  constructor(options: {
    capture: SlotTerminalFrameCaptureBackend;
    target: string;
    socketPath?: string;
    activeIntervalMs?: number;
    idleIntervalMs?: number;
    onFrame: (frame: SlotTerminalFrame) => void;
    onError: (error: unknown) => void;
  }) {
    this.capture = options.capture;
    this.target = options.target;
    this.socketPath = options.socketPath;
    this.activeIntervalMs = normalizeIntervalMs(options.activeIntervalMs, SLOT_TERMINAL_ACTIVE_FRAME_INTERVAL_MS);
    this.idleIntervalMs = normalizeIntervalMs(options.idleIntervalMs, SLOT_TERMINAL_IDLE_FRAME_INTERVAL_MS);
    this.onFrame = options.onFrame;
    this.onError = options.onError;
  }

  async start(): Promise<void> {
    await this.captureAndSchedule(true);
  }

  configureHint(hint: SlotTerminalPollingHint): void {
    if (hint.visibility) {
      this.visibility = hint.visibility;
    }
    if (typeof hint.active === "boolean") {
      this.active = hint.active;
    }
    this.clearTimer();
  }

  stop(): void {
    this.closed = true;
    this.clearTimer();
  }

  async setVisibility(visibility: SlotTerminalVisibility): Promise<void> {
    if (this.closed || this.visibility === visibility) {
      return;
    }
    this.visibility = visibility;
    this.clearTimer();
    if (visibility === "visible") {
      await this.captureAndSchedule(false);
    }
  }

  async setActive(active: boolean): Promise<void> {
    if (this.closed || this.active === active) {
      return;
    }
    this.active = active;
    this.clearTimer();
    if (this.visibility === "visible") {
      await this.captureAndSchedule(false);
    }
  }

  private async captureAndSchedule(forceEmit: boolean): Promise<void> {
    if (this.isPaused()) {
      return;
    }
    if (this.inFlight) {
      this.scheduleNext();
      return;
    }
    this.inFlight = true;
    try {
      const paneInput = {
        target: this.target,
        socketPath: this.socketPath
      };
      const captureInput = { ...paneInput, initial: this.generation === 0 };
      const data = await this.capture.capturePane(captureInput);
      const dimensions = await this.resolveDimensions(paneInput, data);
      const mouseState = await this.resolveMouseState(paneInput);
      if (this.isPaused()) {
        return;
      }
      const frameKey = `${dimensions.cols}x${dimensions.rows}:${mouseState.mouseAny ? 1 : 0}${mouseState.mouseSgr ? 1 : 0}\u0000${data}`;
      if (forceEmit || frameKey !== this.lastFrameKey) {
        this.lastFrameKey = frameKey;
        this.onFrame({
          data,
          cols: dimensions.cols,
          rows: dimensions.rows,
          generation: ++this.generation,
          initial: this.generation === 1,
          mouseAny: mouseState.mouseAny,
          mouseSgr: mouseState.mouseSgr
        });
      }
    } catch (error) {
      if (!this.closed) {
        this.onError(error);
        this.stop();
      }
      return;
    } finally {
      this.inFlight = false;
    }
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.isPaused()) {
      return;
    }
    this.clearTimer();
    const delay = this.active ? this.activeIntervalMs : this.idleIntervalMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.captureAndSchedule(false);
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (!this.timer) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }

  private isPaused(): boolean {
    return this.closed || this.visibility === "hidden";
  }

  private async resolveDimensions(input: SlotTerminalCaptureInput, data: string): Promise<SlotTerminalPaneDimensions> {
    return (await this.capture.getPaneDimensions?.(input)) ?? inferFrameDimensions(data);
  }

  private async resolveMouseState(input: SlotTerminalCaptureInput): Promise<SlotTerminalPaneMouseState> {
    return (await this.capture.getPaneMouseState?.(input)) ?? { mouseAny: false, mouseSgr: false };
  }
}

export function inferFrameDimensions(data: string): { cols: number; rows: number } {
  const normalized = data.replace(/\r\n/g, "\n");
  if (!normalized) {
    return { cols: 0, rows: 0 };
  }
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  const rows = lines.length;
  const cols = lines.reduce((max, line) => Math.max(max, stripAnsi(line).length), 0);
  return { cols, rows };
}

function normalizeIntervalMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.round(value);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}

function parsePaneDimensions(value: string): SlotTerminalPaneDimensions {
  const [colsRaw = "", rowsRaw = ""] = value.trim().split(/\s+/);
  const cols = Number.parseInt(colsRaw, 10);
  const rows = Number.parseInt(rowsRaw, 10);
  if (!Number.isFinite(cols) || cols <= 0 || !Number.isFinite(rows) || rows <= 0) {
    throw new Error(`invalid tmux pane dimensions: ${value.trim()}`);
  }
  return { cols, rows };
}

function parsePaneMouseState(value: string): SlotTerminalPaneMouseState {
  const [anyRaw = "", sgrRaw = ""] = value.trim().split(/\s+/);
  return {
    mouseAny: anyRaw === "1",
    mouseSgr: sgrRaw === "1"
  };
}
