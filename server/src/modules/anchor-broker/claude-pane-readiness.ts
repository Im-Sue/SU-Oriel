import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  buildAnchorTmuxSocketPath,
  type ExecFileProcess
} from "../anchor-terminal/tmux.service.js";

const execFileAsync = promisify(execFile);
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 3_000;
const CLAUDE_TUI_READY_TITLE = "Claude Code";

export interface ClaudeTuiReadinessOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  execFileProcess?: ExecFileProcess;
  clock?: () => number;
}

export interface ClaudeTuiReadinessResult {
  ready: boolean;
  elapsedMs: number;
  lastTitles: string[];
}

export async function waitForClaudeTuiReady(
  anchorPath: string,
  options: ClaudeTuiReadinessOptions = {}
): Promise<ClaudeTuiReadinessResult> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execFileProcess = options.execFileProcess ?? (async (command, args) => await execFileAsync(command, args));
  const clock = options.clock ?? (() => Date.now());
  const startedAt = clock();
  const socketPath = buildAnchorTmuxSocketPath(anchorPath);
  let lastTitles: string[] = [];

  while (true) {
    try {
      const { stdout } = await execFileProcess("tmux", [
        "-S",
        socketPath,
        "list-panes",
        "-a",
        "-F",
        "#{pane_title}"
      ]);
      lastTitles = parsePaneTitles(stdout);
      if (lastTitles.some((title) => title.includes(CLAUDE_TUI_READY_TITLE))) {
        return { ready: true, elapsedMs: clock() - startedAt, lastTitles };
      }
    } catch {
      // tmux may briefly reject list-panes while the anchor socket/session settles.
    }

    const elapsedMs = clock() - startedAt;
    if (elapsedMs >= timeoutMs) {
      return { ready: false, elapsedMs, lastTitles };
    }
    await sleep(pollIntervalMs);
  }
}

function parsePaneTitles(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
