import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SLOT_TERMINAL_WHEEL_FLUSH_MS,
  createSlotTerminalWheelForwardState,
  handleSlotTerminalWheel,
  normalizeWheelDeltaToLines,
  type SlotTerminalWheelEvent,
  type SlotTerminalWheelScheduler,
  type SlotTerminalWheelTerminal
} from "./SlotTerminalWheel.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("SlotTerminalWheel", () => {
  it("forwards mouse-on wheel events as coalesced SGR 1006 input", async () => {
    vi.useFakeTimers();
    const host = createHost();
    const terminal = createTerminal();
    const sendInput = vi.fn();
    const state = createSlotTerminalWheelForwardState();

    handleSlotTerminalWheel(createWheelEvent({ deltaY: -24, clientX: 55, clientY: 45 }), {
      host,
      terminal,
      mouseState: { mouseAny: true, mouseSgr: true },
      forwardState: state,
      sendInput,
      scheduler: timerScheduler()
    });
    handleSlotTerminalWheel(createWheelEvent({ deltaY: -24, clientX: 55, clientY: 45 }), {
      host,
      terminal,
      mouseState: { mouseAny: true, mouseSgr: true },
      forwardState: state,
      sendInput,
      scheduler: timerScheduler()
    });

    expect(sendInput).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SLOT_TERMINAL_WHEEL_FLUSH_MS);

    expect(sendInput).toHaveBeenCalledTimes(1);
    expect(sendInput).toHaveBeenCalledWith("\u001b[<64;5;2M\u001b[<64;5;2M");
    expect(terminal.scrollLines).not.toHaveBeenCalled();
    expect(host.scrollTop).toBe(0);
  });

  it("keeps local scrolling when SGR mouse is off", () => {
    const host = createHost();
    host.scrollTop = 40;
    const terminal = createTerminal();
    const event = createWheelEvent({ deltaY: -20 });

    const handled = handleSlotTerminalWheel(event, {
      host,
      terminal,
      mouseState: { mouseAny: true, mouseSgr: false },
      forwardState: createSlotTerminalWheelForwardState(),
      sendInput: vi.fn(),
      scheduler: timerScheduler()
    });

    expect(handled).toBe(true);
    expect(host.scrollTop).toBe(20);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(terminal.scrollLines).not.toHaveBeenCalled();
  });

  it("uses Shift wheel as the local-scroll escape hatch even when mouse is on", () => {
    const host = createHost();
    host.scrollTop = 0;
    const terminal = createTerminal();
    const sendInput = vi.fn();

    handleSlotTerminalWheel(createWheelEvent({ deltaY: -32, shiftKey: true }), {
      host,
      terminal,
      mouseState: { mouseAny: true, mouseSgr: true },
      forwardState: createSlotTerminalWheelForwardState(),
      sendInput,
      scheduler: timerScheduler()
    });

    expect(sendInput).not.toHaveBeenCalled();
    expect(terminal.scrollLines).toHaveBeenCalledWith(-2);
  });

  it("normalizes pixel, line, and page wheel delta modes", () => {
    const host = createHost({ clientHeight: 200, screenHeight: 200 });
    expect(normalizeWheelDeltaToLines({ deltaMode: 0, deltaY: 20 }, { host, terminal: { rows: 10 } })).toBe(1);
    expect(normalizeWheelDeltaToLines({ deltaMode: 1, deltaY: 3 }, { host, terminal: { rows: 10 } })).toBe(3);
    expect(normalizeWheelDeltaToLines({ deltaMode: 2, deltaY: 1 }, { host, terminal: { rows: 10 } })).toBe(10);
  });

  it("accumulates trackpad sub-line deltas and clamps coordinates to the pane", async () => {
    vi.useFakeTimers();
    const host = createHost();
    const sendInput = vi.fn();
    const state = createSlotTerminalWheelForwardState();
    const input = {
      host,
      terminal: createTerminal(),
      mouseState: { mouseAny: true, mouseSgr: true },
      forwardState: state,
      sendInput,
      scheduler: timerScheduler()
    };

    handleSlotTerminalWheel(createWheelEvent({ deltaY: -6, clientX: -100, clientY: -100 }), input);
    handleSlotTerminalWheel(createWheelEvent({ deltaY: -6, clientX: -100, clientY: -100 }), input);
    handleSlotTerminalWheel(createWheelEvent({ deltaY: -6, clientX: -100, clientY: -100 }), input);
    handleSlotTerminalWheel(createWheelEvent({ deltaY: -6, clientX: -100, clientY: -100 }), input);
    await vi.advanceTimersByTimeAsync(SLOT_TERMINAL_WHEEL_FLUSH_MS);

    expect(sendInput).toHaveBeenCalledWith("\u001b[<64;1;1M");
  });
});

function createHost(options: { clientHeight?: number; screenHeight?: number } = {}): HTMLElement {
  const host = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  screen.getBoundingClientRect = () =>
    ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 1010,
      bottom: 620,
      width: 1000,
      height: options.screenHeight ?? 600,
      toJSON: () => ({})
    }) as DOMRect;
  host.append(screen);
  Object.defineProperty(host, "clientHeight", { configurable: true, value: options.clientHeight ?? 200 });
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 1000 });
  Object.defineProperty(host, "scrollHeight", { configurable: true, value: 800 });
  return host;
}

function createTerminal(): SlotTerminalWheelTerminal {
  return {
    cols: 100,
    rows: 30,
    buffer: { active: { baseY: 20, viewportY: 20 } },
    scrollLines: vi.fn()
  };
}

function createWheelEvent(input: {
  deltaY: number;
  clientX?: number;
  clientY?: number;
  deltaMode?: number;
  shiftKey?: boolean;
}): SlotTerminalWheelEvent {
  return {
    clientX: input.clientX ?? 20,
    clientY: input.clientY ?? 30,
    deltaMode: input.deltaMode ?? 0,
    deltaY: input.deltaY,
    preventDefault: vi.fn(),
    shiftKey: input.shiftKey ?? false,
    stopPropagation: vi.fn()
  };
}

function timerScheduler(): SlotTerminalWheelScheduler {
  return {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  };
}
