import assert from "node:assert/strict";
import { join } from "node:path";

import { test } from "vitest";

import {
  CcbdReadinessProbe,
  CcbdReadinessTimeoutError
} from "./ccbd-readiness.service.js";

test("waitForReady reads lifecycle socket, verifies socket stat, and connects", async () => {
  const calls: string[] = [];
  const probe = new CcbdReadinessProbe({
    readTextFile: async (path) => {
      calls.push(`read:${path}`);
      if (path.endsWith("lifecycle.json")) {
        return JSON.stringify({
          desired_state: "running",
          owner_pid: 123,
          keeper_pid: 456,
          socket_path: "/tmp/anchor-a/.ccb/ccbd/ready.sock"
        });
      }
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    statPath: async (path) => {
      calls.push(`stat:${path}`);
      return { isSocket: () => true };
    },
    connectSocket: async (path) => {
      calls.push(`connect:${path}`);
    },
    sleep: async () => undefined
  });

  const result = await probe.waitForReady("/tmp/anchor-a", { timeoutMs: 1000 });

  assert.equal(result.socketPath, "/tmp/anchor-a/.ccb/ccbd/ready.sock");
  assert.equal(result.attempts, 1);
  assert.deepEqual(calls, [
    "read:/tmp/anchor-a/.ccb/ccbd/lifecycle.json",
    "stat:/tmp/anchor-a/.ccb/ccbd/ready.sock",
    "connect:/tmp/anchor-a/.ccb/ccbd/ready.sock"
  ]);
});

test("waitForReady times out with lifecycle, socket path, and last error diagnostics", async () => {
  let now = 0;
  const anchorPath = "/tmp/anchor-timeout";
  const probe = new CcbdReadinessProbe({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    readTextFile: async (path) => {
      if (path.endsWith("lifecycle.json")) {
        return JSON.stringify({
          desired_state: "stopped",
          owner_pid: null,
          keeper_pid: 789,
          socket_path: null
        });
      }
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    statPath: async () => {
      throw Object.assign(new Error("no socket"), { code: "ENOENT" });
    },
    connectSocket: async () => undefined
  });

  await assert.rejects(
    () => probe.waitForReady(anchorPath, { timeoutMs: 750 }),
    (error: unknown) => {
      assert.ok(error instanceof CcbdReadinessTimeoutError);
      assert.match(error.message, /ccbd readiness timeout/);
      assert.match(error.message, /desired_state=stopped/);
      assert.match(error.message, /keeper_pid=789/);
      assert.match(error.message, /last_error=ENOENT/);
      assert.equal(error.diagnostics.socketPath, join(anchorPath, ".ccb", "ccbd", "ccbd.sock"));
      assert.equal(error.diagnostics.lastErrorCode, "ENOENT");
      return true;
    }
  );
});
