import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { resolveAnchorTmuxSession } from "./anchor-session-resolver.js";
import type { AnchorTerminalPane, AnchorTerminalTmuxBackend } from "./types.js";

const execFileAsync = promisify(execFile);
const SEND_KEYS_LITERAL_CHUNK_SIZE = 32 * 1024;

export interface TmuxCommandResult {
  stdout: string;
  stderr: string;
}

export type ExecFileProcess = (command: string, args: string[]) => Promise<TmuxCommandResult>;

export class AnchorTerminalTmuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorTerminalTmuxError";
  }
}

export class TmuxAnchorTerminalService implements AnchorTerminalTmuxBackend {
  private readonly tmuxCommand: string;
  private readonly execFileProcess: ExecFileProcess;

  constructor(options: { tmuxCommand?: string; execFileProcess?: ExecFileProcess } = {}) {
    this.tmuxCommand = options.tmuxCommand ?? "tmux";
    this.execFileProcess = options.execFileProcess ?? (async (command, args) => await execFileAsync(command, args));
  }

  async listPanes(anchor: { anchorPath: string }): Promise<AnchorTerminalPane[]> {
    const sessionName = await this.resolveAnchorSession(anchor.anchorPath);
    const { stdout } = await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "list-panes",
      "-t",
      sessionName,
      "-F",
      "#{pane_id}\t#{pane_title}\t#{pane_current_command}\t#{window_index}\t#{pane_index}\t#{pane_active}\t#{pane_width}\t#{pane_height}"
    ]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parsePaneLine(line, sessionName));
  }

  async capturePane(anchor: { anchorPath: string }, pane: AnchorTerminalPane): Promise<string> {
    const { stdout } = await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "capture-pane",
      "-p",
      "-e",
      "-J",
      "-S",
      "-2000",
      "-t",
      pane.paneId
    ]);
    return stdout;
  }

  async captureFrame(
    anchor: { anchorPath: string },
    pane: AnchorTerminalPane
  ): Promise<{ data: string; cols: number; rows: number }> {
    const size = await this.getPaneSize(anchor, pane);
    const data = await this.capturePane(anchor, pane);
    return {
      data,
      cols: size.cols,
      rows: size.rows
    };
  }

  async startPipe(anchor: { anchorPath: string }, pane: AnchorTerminalPane, outputPath: string): Promise<void> {
    await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "pipe-pane",
      "-o",
      "-t",
      pane.paneId,
      `cat > ${shellQuote(outputPath)}`
    ]);
  }

  async stopPipe(anchor: { anchorPath: string }, pane: AnchorTerminalPane): Promise<void> {
    await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "pipe-pane",
      "-t",
      pane.paneId
    ]);
  }

  async getWindowLayout(anchor: { anchorPath: string }, sessionName: string): Promise<string> {
    const { stdout } = await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "display-message",
      "-p",
      "-t",
      sessionName,
      "#{window_layout}"
    ]);
    return stdout.trim();
  }

  async resizeWindow(anchor: { anchorPath: string }, sessionName: string, cols: number, rows: number): Promise<void> {
    await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "resize-window",
      "-t",
      sessionName,
      "-x",
      String(cols),
      "-y",
      String(rows)
    ]);
  }

  async zoomPane(anchor: { anchorPath: string }, pane: AnchorTerminalPane): Promise<void> {
    // 先切 active pane 到目标，然后确保 window 处于 zoom 状态
    await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "select-pane",
      "-t",
      pane.paneId
    ]);
    const zoomed = await this.isWindowZoomed(anchor, pane);
    if (!zoomed) {
      await this.execFileProcess(this.tmuxCommand, [
        "-S",
        buildAnchorTmuxSocketPath(anchor.anchorPath),
        "resize-pane",
        "-Z",
        "-t",
        pane.paneId
      ]);
    }
  }

  async unzoomPane(anchor: { anchorPath: string }, pane: AnchorTerminalPane): Promise<void> {
    // 只有 window 处于 zoom 状态才 toggle off
    const zoomed = await this.isWindowZoomed(anchor, pane);
    if (zoomed) {
      await this.execFileProcess(this.tmuxCommand, [
        "-S",
        buildAnchorTmuxSocketPath(anchor.anchorPath),
        "resize-pane",
        "-Z",
        "-t",
        pane.paneId
      ]);
    }
  }

  async getPaneSize(anchor: { anchorPath: string }, pane: AnchorTerminalPane): Promise<{ cols: number; rows: number }> {
    const { stdout } = await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "display-message",
      "-p",
      "-t",
      pane.paneId,
      "#{pane_width}\t#{pane_height}"
    ]);
    const [width = "0", height = "0"] = stdout.trim().split("\t");
    return {
      cols: Number.parseInt(width, 10) || pane.cols,
      rows: Number.parseInt(height, 10) || pane.rows
    };
  }

  private async isWindowZoomed(anchor: { anchorPath: string }, pane: AnchorTerminalPane): Promise<boolean> {
    try {
      const { stdout } = await this.execFileProcess(this.tmuxCommand, [
        "-S",
        buildAnchorTmuxSocketPath(anchor.anchorPath),
        "display-message",
        "-p",
        "-t",
        pane.paneId,
        "#{window_zoomed_flag}"
      ]);
      return stdout.trim() === "1";
    } catch {
      return false;
    }
  }

  async restoreLayout(anchor: { anchorPath: string }, sessionName: string, layout: string): Promise<void> {
    await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "select-layout",
      "-t",
      sessionName,
      layout
    ]);
  }

  async resizePane(
    anchor: { anchorPath: string },
    pane: AnchorTerminalPane,
    cols: number,
    rows: number
  ): Promise<void> {
    await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildAnchorTmuxSocketPath(anchor.anchorPath),
      "resize-pane",
      "-t",
      pane.paneId,
      "-x",
      String(cols),
      "-y",
      String(rows)
    ]);
  }

  async sendKeysLiteral(anchor: { anchorPath: string }, pane: AnchorTerminalPane, data: string): Promise<void> {
    if (!data) {
      return;
    }
    for (const chunk of chunkString(data, SEND_KEYS_LITERAL_CHUNK_SIZE)) {
      await this.execFileProcess(this.tmuxCommand, [
        "-S",
        buildAnchorTmuxSocketPath(anchor.anchorPath),
        "send-keys",
        "-t",
        pane.paneId,
        "-l",
        chunk
      ]);
    }
  }

  private async resolveAnchorSession(anchorPath: string): Promise<string> {
    try {
      return await resolveAnchorTmuxSession({
        tmuxCommand: this.tmuxCommand,
        socketPath: buildAnchorTmuxSocketPath(anchorPath),
        anchorPath,
        execFileProcess: this.execFileProcess
      });
    } catch (error) {
      throw new AnchorTerminalTmuxError(error instanceof Error ? error.message : "anchor tmux session not found");
    }
  }
}

export function buildAnchorTmuxSocketPath(anchorPath: string): string {
  return join(anchorPath, ".ccb", "ccbd", "tmux.sock");
}

function parsePaneLine(line: string, sessionName: string): AnchorTerminalPane {
  const [
    paneId = "",
    title = "",
    currentCommand = "",
    windowIndex = "0",
    paneIndex = "0",
    active = "0",
    width = "80",
    height = "24"
  ] = line.split("\t");
  return {
    name: normalizePaneName(title, currentCommand, paneId),
    paneId,
    title,
    currentCommand,
    sessionName,
    windowIndex: Number.parseInt(windowIndex, 10) || 0,
    paneIndex: Number.parseInt(paneIndex, 10) || 0,
    active: active === "1",
    cols: Number.parseInt(width, 10) || 80,
    rows: Number.parseInt(height, 10) || 24
  };
}

function normalizePaneName(title: string, currentCommand: string, paneId: string): string {
  const normalizedTitle = title.trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }
  const normalizedCommand = currentCommand.trim();
  return normalizedCommand || paneId;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function chunkString(value: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < value.length; start += maxLength) {
    chunks.push(value.slice(start, start + maxLength));
  }
  return chunks;
}
