export type SlotTerminalPaneMouseState = {
  mouseAny: boolean;
  mouseSgr: boolean;
};

type WheelDirection = -1 | 0 | 1;

export type SlotTerminalWheelForwardState = {
  accumulatedLines: number;
  accumulationDirection: WheelDirection;
  pendingTicks: number;
  pendingDirection: WheelDirection;
  pendingCell: { col: number; row: number } | null;
  flushTimer: unknown | null;
};

export type SlotTerminalWheelTerminal = {
  cols?: number;
  rows?: number;
  buffer?: {
    active?: {
      viewportY: number;
      baseY: number;
    };
  };
  scrollLines(lines: number): void;
};

export type SlotTerminalWheelEvent = Pick<
  WheelEvent,
  "clientX" | "clientY" | "deltaMode" | "deltaY" | "preventDefault" | "shiftKey" | "stopPropagation"
>;

export type SlotTerminalWheelScheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const SLOT_TERMINAL_WHEEL_FLUSH_MS = 32;
export const SLOT_TERMINAL_WHEEL_MAX_TICKS_PER_EVENT = 8;
export const SLOT_TERMINAL_WHEEL_MAX_TICKS_PER_FLUSH = 24;

const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const DEFAULT_CELL_HEIGHT = 16;

export function createSlotTerminalWheelForwardState(): SlotTerminalWheelForwardState {
  return {
    accumulatedLines: 0,
    accumulationDirection: 0,
    pendingTicks: 0,
    pendingDirection: 0,
    pendingCell: null,
    flushTimer: null
  };
}

export function handleSlotTerminalWheel(
  event: SlotTerminalWheelEvent,
  input: {
    host: HTMLElement;
    terminal: SlotTerminalWheelTerminal;
    mouseState: SlotTerminalPaneMouseState;
    forwardState: SlotTerminalWheelForwardState;
    sendInput: (data: string) => void;
    scheduler: SlotTerminalWheelScheduler;
  }
): boolean {
  if (event.deltaY === 0) {
    return false;
  }
  if (!event.shiftKey && input.mouseState.mouseAny && input.mouseState.mouseSgr) {
    enqueueForwardWheel(event, input);
    stopWheelEvent(event);
    return true;
  }
  return applyLocalWheel(event, input.host, input.terminal);
}

export function flushSlotTerminalWheelForward(
  state: SlotTerminalWheelForwardState,
  sendInput: (data: string) => void
): void {
  if (!state.pendingTicks || !state.pendingCell || state.pendingDirection === 0) {
    state.pendingTicks = 0;
    state.pendingDirection = 0;
    state.pendingCell = null;
    return;
  }
  const ticks = Math.min(state.pendingTicks, SLOT_TERMINAL_WHEEL_MAX_TICKS_PER_FLUSH);
  sendInput(buildSgrWheelInput(state.pendingDirection, ticks, state.pendingCell));
  state.pendingTicks = 0;
  state.pendingDirection = 0;
  state.pendingCell = null;
}

export function cancelSlotTerminalWheelForward(
  state: SlotTerminalWheelForwardState,
  scheduler: Pick<SlotTerminalWheelScheduler, "clearTimeout">
): void {
  if (state.flushTimer) {
    scheduler.clearTimeout(state.flushTimer);
  }
  state.flushTimer = null;
  state.pendingTicks = 0;
  state.pendingDirection = 0;
  state.pendingCell = null;
  state.accumulatedLines = 0;
  state.accumulationDirection = 0;
}

export function normalizeWheelDeltaToLines(
  event: Pick<WheelEvent, "deltaMode" | "deltaY">,
  input: { host: HTMLElement; terminal: Pick<SlotTerminalWheelTerminal, "rows"> }
): number {
  const lineHeight = measureCellHeight(input.host, input.terminal.rows ?? 0);
  if (event.deltaMode === DOM_DELTA_LINE) {
    return event.deltaY;
  }
  if (event.deltaMode === DOM_DELTA_PAGE) {
    return event.deltaY * Math.max(1, input.host.clientHeight / lineHeight);
  }
  if (event.deltaMode === DOM_DELTA_PIXEL) {
    return event.deltaY / lineHeight;
  }
  return event.deltaY / lineHeight;
}

export function buildSgrWheelInput(
  direction: Exclude<WheelDirection, 0>,
  ticks: number,
  cell: { col: number; row: number }
): string {
  const button = direction < 0 ? 64 : 65;
  return `\u001b[<${button};${cell.col};${cell.row}M`.repeat(Math.max(0, ticks));
}

function enqueueForwardWheel(
  event: SlotTerminalWheelEvent,
  input: {
    host: HTMLElement;
    terminal: SlotTerminalWheelTerminal;
    forwardState: SlotTerminalWheelForwardState;
    sendInput: (data: string) => void;
    scheduler: SlotTerminalWheelScheduler;
  }
): void {
  const lines = normalizeWheelDeltaToLines(event, input);
  const direction: Exclude<WheelDirection, 0> = lines < 0 ? -1 : 1;
  const state = input.forwardState;
  if (state.accumulationDirection !== 0 && state.accumulationDirection !== direction) {
    state.accumulatedLines = 0;
  }
  state.accumulationDirection = direction;
  state.accumulatedLines += Math.abs(lines);
  const availableTicks = Math.floor(state.accumulatedLines);
  const ticks = Math.min(availableTicks, SLOT_TERMINAL_WHEEL_MAX_TICKS_PER_EVENT);
  if (ticks <= 0) {
    return;
  }
  state.accumulatedLines = availableTicks > SLOT_TERMINAL_WHEEL_MAX_TICKS_PER_EVENT ? 0 : state.accumulatedLines - ticks;
  const cell = resolveTerminalCell(event, input.host, input.terminal);
  if (
    state.pendingTicks > 0 &&
    (state.pendingDirection !== direction || state.pendingCell?.col !== cell.col || state.pendingCell?.row !== cell.row)
  ) {
    flushPendingTimer(state, input.scheduler);
    flushSlotTerminalWheelForward(state, input.sendInput);
  }
  state.pendingDirection = direction;
  state.pendingCell = cell;
  state.pendingTicks = Math.min(state.pendingTicks + ticks, SLOT_TERMINAL_WHEEL_MAX_TICKS_PER_FLUSH);
  if (!state.flushTimer) {
    state.flushTimer = input.scheduler.setTimeout(() => {
      state.flushTimer = null;
      flushSlotTerminalWheelForward(state, input.sendInput);
    }, SLOT_TERMINAL_WHEEL_FLUSH_MS);
  }
}

function applyLocalWheel(event: SlotTerminalWheelEvent, host: HTMLElement, terminal: SlotTerminalWheelTerminal): boolean {
  const dy = event.deltaY;
  const atHostTop = host.scrollTop <= 0;
  const atHostBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 1;
  const active = terminal.buffer?.active;
  const historyAtBottom = !active || active.viewportY >= active.baseY;
  const lines = Math.max(1, Math.round(Math.abs(dy) / DEFAULT_CELL_HEIGHT));
  if (dy < 0) {
    if (!atHostTop) {
      host.scrollTop += dy;
    } else {
      terminal.scrollLines(-lines);
    }
  } else if (!historyAtBottom) {
    terminal.scrollLines(lines);
  } else if (!atHostBottom) {
    host.scrollTop += dy;
  } else {
    return false;
  }
  stopWheelEvent(event);
  return true;
}

function resolveTerminalCell(
  event: Pick<WheelEvent, "clientX" | "clientY">,
  host: HTMLElement,
  terminal: Pick<SlotTerminalWheelTerminal, "cols" | "rows">
): { col: number; row: number } {
  const cols = positiveInteger(terminal.cols, 1);
  const rows = positiveInteger(terminal.rows, 1);
  const screen = (host.querySelector(".xterm-screen") as HTMLElement | null) ?? host;
  const rect = screen.getBoundingClientRect();
  const cellWidth = rect.width > 0 ? rect.width / cols : Math.max(1, host.clientWidth / cols);
  const cellHeight = rect.height > 0 ? rect.height / rows : measureCellHeight(host, rows);
  return {
    col: clamp(Math.floor((event.clientX - rect.left) / cellWidth) + 1, 1, cols),
    row: clamp(Math.floor((event.clientY - rect.top) / cellHeight) + 1, 1, rows)
  };
}

function measureCellHeight(host: HTMLElement, rows: number): number {
  const rowElement = host.querySelector(".xterm-rows > div") as HTMLElement | null;
  const rowHeight = rowElement?.getBoundingClientRect().height ?? 0;
  if (rowHeight > 0) {
    return rowHeight;
  }
  const screen = (host.querySelector(".xterm-screen") as HTMLElement | null) ?? host;
  const screenHeight = screen.getBoundingClientRect().height;
  if (screenHeight > 0 && rows > 0) {
    return screenHeight / rows;
  }
  return DEFAULT_CELL_HEIGHT;
}

function flushPendingTimer(
  state: SlotTerminalWheelForwardState,
  scheduler: Pick<SlotTerminalWheelScheduler, "clearTimeout">
): void {
  if (state.flushTimer) {
    scheduler.clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
}

function stopWheelEvent(event: Pick<WheelEvent, "preventDefault" | "stopPropagation">): void {
  event.preventDefault();
  event.stopPropagation();
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
