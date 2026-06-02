import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useXtermTerminal } from "./useXtermTerminal.js";

const xtermMocks = vi.hoisted(() => ({
  Terminal: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    open: vi.fn(),
    unicode: { activeVersion: "" }
  }))
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: xtermMocks.Terminal
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: vi.fn()
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("useXtermTerminal", () => {
  it("enables xterm convertEol so tmux LF snapshots return to column zero", () => {
    render(<Harness />);

    expect(xtermMocks.Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        convertEol: true
      })
    );
  });
});

function Harness() {
  const { containerRef } = useXtermTerminal({
    onInput: vi.fn()
  });
  return <div ref={containerRef} />;
}
