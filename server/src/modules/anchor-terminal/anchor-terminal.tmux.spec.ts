import { describe, expect, it, vi } from "vitest";

import { TmuxAnchorTerminalService, type ExecFileProcess } from "./tmux.service.js";

describe("anchor-terminal tmux discovery", () => {
  it("lists panes from the anchor tmux socket and resolves ccb panes by title", async () => {
    const execFile = vi.fn(async (command: string, args: string[]) => {
      if (args.includes("list-sessions")) {
        return { stdout: "ccb-su-ccb-task-task-1-a1b2\nother-session\n", stderr: "" };
      }
      if (args.includes("list-panes")) {
        return {
          stdout: [
            "%1\t__ccb_ctl\tbash\t0\t0\t0",
            "%2\tccb_claude\tpython\t0\t1\t1",
            "%3\tccb_codex\tpython\t0\t2\t0"
          ].join("\n"),
          stderr: ""
        };
      }
      if (args.includes("capture-pane")) {
        return { stdout: "\u001b[32mhello\u001b[0m\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const service = new TmuxAnchorTerminalService({ execFileProcess: execFile });

    const panes = await service.listPanes({ anchorPath: "/repo/SU-CCB-task-1" });
    const capture = await service.capturePane({ anchorPath: "/repo/SU-CCB-task-1" }, panes[1]);

    expect(panes.map((pane) => pane.name)).toEqual(["__ccb_ctl", "ccb_claude", "ccb_codex"]);
    expect(panes[1]).toMatchObject({ paneId: "%2", sessionName: "ccb-su-ccb-task-task-1-a1b2" });
    expect(capture).toBe("\u001b[32mhello\u001b[0m\n");
    expect(execFile).toHaveBeenCalledWith(
      "tmux",
      ["-S", "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock", "list-sessions", "-F", "#{session_name}"]
    );
    expect(execFile).toHaveBeenCalledWith(
      "tmux",
      expect.arrayContaining(["capture-pane", "-p", "-e", "-J", "-S", "-2000", "-t", "%2"])
    );
  });

  it("builds viewport lease tmux commands against the anchor socket", async () => {
    const execFile = vi.fn(async (command: string, args: string[]) => {
      if (args.includes("display-message")) {
        return { stdout: "original-layout\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const service = new TmuxAnchorTerminalService({ execFileProcess: execFile });
    const anchor = { anchorPath: "/repo/SU-CCB-task-1" };
    const pane = {
      name: "ccb_claude",
      paneId: "%2",
      title: "ccb_claude",
      currentCommand: "python",
      sessionName: "ccb-su-ccb-task-task-1-a1b2",
      windowIndex: 0,
      paneIndex: 1,
      active: true,
      cols: 80,
      rows: 24
    };

    await expect(service.getWindowLayout(anchor, pane.sessionName)).resolves.toBe("original-layout");
    await service.resizeWindow(anchor, pane.sessionName, 142, 38);
    await service.zoomPane(anchor, pane);
    await service.unzoomPane(anchor, pane);
    await service.restoreLayout(anchor, pane.sessionName, "original-layout");

    expect(execFile).toHaveBeenCalledWith("tmux", [
      "-S",
      "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock",
      "display-message",
      "-p",
      "-t",
      "ccb-su-ccb-task-task-1-a1b2",
      "#{window_layout}"
    ]);
    expect(execFile).toHaveBeenCalledWith("tmux", [
      "-S",
      "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock",
      "resize-window",
      "-t",
      "ccb-su-ccb-task-task-1-a1b2",
      "-x",
      "142",
      "-y",
      "38"
    ]);
    expect(execFile).toHaveBeenCalledWith("tmux", [
      "-S",
      "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock",
      "resize-pane",
      "-Z",
      "-t",
      "%2"
    ]);
    expect(execFile).toHaveBeenCalledWith("tmux", [
      "-S",
      "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock",
      "select-layout",
      "-t",
      "ccb-su-ccb-task-task-1-a1b2",
      "original-layout"
    ]);
  });

  it("captures authoritative pane frame with current pane size", async () => {
    const execFile = vi.fn(async (command: string, args: string[]) => {
      if (args.includes("display-message")) {
        return { stdout: "79\t31\n", stderr: "" };
      }
      if (args.includes("capture-pane")) {
        return { stdout: "\u001b[32mframe\u001b[0m\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const service = new TmuxAnchorTerminalService({ execFileProcess: execFile });
    const anchor = { anchorPath: "/repo/SU-CCB-task-1" };
    const pane = {
      name: "ccb_claude",
      paneId: "%2",
      title: "ccb_claude",
      currentCommand: "python",
      sessionName: "ccb-su-ccb-task-task-1-a1b2",
      windowIndex: 0,
      paneIndex: 1,
      active: true,
      cols: 80,
      rows: 24
    };

    await expect(service.captureFrame(anchor, pane)).resolves.toEqual({
      data: "\u001b[32mframe\u001b[0m\n",
      cols: 79,
      rows: 31
    });

    expect(execFile).toHaveBeenCalledWith("tmux", [
      "-S",
      "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock",
      "display-message",
      "-p",
      "-t",
      "%2",
      "#{pane_width}\t#{pane_height}"
    ]);
    expect(execFile).toHaveBeenCalledWith("tmux", [
      "-S",
      "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock",
      "capture-pane",
      "-p",
      "-e",
      "-J",
      "-S",
      "-2000",
      "-t",
      "%2"
    ]);
  });

  it("sends literal keystrokes through tmux send-keys and chunks large paste data", async () => {
    const execFile = vi.fn<ExecFileProcess>(async () => ({ stdout: "", stderr: "" }));
    const service = new TmuxAnchorTerminalService({ execFileProcess: execFile });
    const anchor = { anchorPath: "/repo/SU-CCB-task-1" };
    const pane = {
      name: "ccb_claude",
      paneId: "%2",
      title: "ccb_claude",
      currentCommand: "python",
      sessionName: "ccb-su-ccb-task-task-1-a1b2",
      windowIndex: 0,
      paneIndex: 1,
      active: true,
      cols: 80,
      rows: 24
    };

    await service.sendKeysLiteral(anchor, pane, "\u0003");
    await service.sendKeysLiteral(anchor, pane, "x".repeat(33 * 1024));

    expect(execFile).toHaveBeenCalledWith("tmux", [
      "-S",
      "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock",
      "send-keys",
      "-t",
      "%2",
      "-l",
      "\u0003"
    ]);
    const sendCalls = execFile.mock.calls.filter(([, args]) => args.includes("send-keys"));
    expect(sendCalls).toHaveLength(3);
    expect(sendCalls[1]?.[1].at(-1)).toHaveLength(32 * 1024);
    expect(sendCalls[2]?.[1].at(-1)).toHaveLength(1024);
  });
});
