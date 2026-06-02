import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import { waitForClaudeTuiReady, type ClaudeTuiReadinessOptions } from "./claude-pane-readiness.js";

type ExecFileProcess = NonNullable<ClaudeTuiReadinessOptions["execFileProcess"]>;

afterEach(() => {
  vi.useRealTimers();
});

test("waitForClaudeTuiReady resolves ready when a later poll sees Claude Code pane title", async () => {
  let pollCount = 0;
  const execFileProcess = vi.fn<ExecFileProcess>(async () => {
    pollCount += 1;
    return {
      stdout: pollCount < 3 ? "ccb_claude\nccb_codex\n" : "ccb_claude\n✳ Claude Code\nccb_codex\n",
      stderr: ""
    };
  });

  const result = await waitForClaudeTuiReady("/repo/SU-CCB-task-1", {
    execFileProcess,
    pollIntervalMs: 1,
    timeoutMs: 20,
    clock: () => pollCount
  });

  assert.deepEqual(result, {
    ready: true,
    elapsedMs: 3,
    lastTitles: ["ccb_claude", "✳ Claude Code", "ccb_codex"]
  });
  assert.equal(execFileProcess.mock.calls.length, 3);
  assert.deepEqual(execFileProcess.mock.calls[0], [
    "tmux",
    ["-S", "/repo/SU-CCB-task-1/.ccb/ccbd/tmux.sock", "list-panes", "-a", "-F", "#{pane_title}"]
  ]);
});

test("waitForClaudeTuiReady returns last pane titles when timeout expires", async () => {
  let now = 0;
  const execFileProcess = vi.fn<ExecFileProcess>(async () => {
    now += 500;
    return { stdout: "ccb_claude\nloading\n", stderr: "" };
  });

  const result = await waitForClaudeTuiReady("/repo/SU-CCB-task-1", {
    execFileProcess,
    pollIntervalMs: 1,
    timeoutMs: 1000,
    clock: () => now
  });

  assert.equal(result.ready, false);
  assert.equal(result.elapsedMs, 1000);
  assert.deepEqual(result.lastTitles, ["ccb_claude", "loading"]);
});

test("waitForClaudeTuiReady keeps polling when tmux list-panes throws", async () => {
  let pollCount = 0;
  const execFileProcess = vi.fn<ExecFileProcess>(async () => {
    pollCount += 1;
    if (pollCount === 1) {
      throw new Error("tmux socket not ready");
    }
    return { stdout: "Claude Code\n", stderr: "" };
  });

  const result = await waitForClaudeTuiReady("/repo/SU-CCB-task-1", {
    execFileProcess,
    pollIntervalMs: 1,
    timeoutMs: 20,
    clock: () => pollCount
  });

  assert.equal(result.ready, true);
  assert.equal(execFileProcess.mock.calls.length, 2);
  assert.deepEqual(result.lastTitles, ["Claude Code"]);
});

test("waitForClaudeTuiReady waits the configured poll interval between probes", async () => {
  vi.useFakeTimers();
  const execFileProcess = vi
    .fn<ExecFileProcess>()
    .mockResolvedValueOnce({ stdout: "ccb_claude\n", stderr: "" })
    .mockResolvedValueOnce({ stdout: "Claude Code\n", stderr: "" });
  const startedAt = Date.now();

  const pending = waitForClaudeTuiReady("/repo/SU-CCB-task-1", {
    execFileProcess,
    pollIntervalMs: 500,
    timeoutMs: 2000,
    clock: () => Date.now() - startedAt
  });

  await vi.waitFor(() => {
    assert.equal(execFileProcess.mock.calls.length, 1);
  });
  await vi.advanceTimersByTimeAsync(499);
  assert.equal(execFileProcess.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);

  const result = await pending;
  assert.equal(result.ready, true);
  assert.equal(execFileProcess.mock.calls.length, 2);
});
