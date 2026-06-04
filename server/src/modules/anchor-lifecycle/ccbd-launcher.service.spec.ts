import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { test } from "vitest";

import { CcbdLauncherService } from "./ccbd-launcher.service.js";

class FakeChild extends EventEmitter {
  pid = 12345;
  unrefCalled = false;

  unref(): void {
    this.unrefCalled = true;
  }
}

type ReplyLangEnv = {
  replyLang?: string;
  lang?: string;
};

async function withReplyLangEnv(env: ReplyLangEnv, run: () => Promise<void>): Promise<void> {
  const previousReplyLang = process.env.CCB_REPLY_LANG;
  const previousLang = process.env.CCB_LANG;
  try {
    if (env.replyLang === undefined) {
      delete process.env.CCB_REPLY_LANG;
    } else {
      process.env.CCB_REPLY_LANG = env.replyLang;
    }

    if (env.lang === undefined) {
      delete process.env.CCB_LANG;
    } else {
      process.env.CCB_LANG = env.lang;
    }

    await run();
  } finally {
    restoreEnv("CCB_REPLY_LANG", previousReplyLang);
    restoreEnv("CCB_LANG", previousLang);
  }
}

function restoreEnv(name: "CCB_REPLY_LANG" | "CCB_LANG", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function captureLaunchCommand(): Promise<string> {
  const child = new FakeChild();
  const calls: unknown[] = [];
  const service = new CcbdLauncherService({
    spawnProcess: ((command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      return child;
    }) as never,
    ensureDirectory: async () => undefined,
    readinessProbe: {
      waitForReady: async () => ({
        socketPath: "/tmp/anchor-a/.ccb/ccbd/ccbd.sock",
        attempts: 1,
        diagnostics: {
          socketPath: "/tmp/anchor-a/.ccb/ccbd/ccbd.sock",
          lastErrorCode: null,
          snapshots: {},
          logTails: {}
        }
      })
    } as never
  });

  await service.start("/tmp/anchor-a");

  const launchCommand = (calls[0] as { args: string[] }).args.at(-1);
  assert.equal(typeof launchCommand, "string");
  return launchCommand;
}

test("start launches ccb inside an isolated tmux session and waits for readiness", async () => {
  const child = new FakeChild();
  const calls: unknown[] = [];
  const service = new CcbdLauncherService({
    spawnProcess: ((command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      return child;
    }) as never,
    ensureDirectory: async () => undefined,
    readinessProbe: {
      waitForReady: async () => ({
        socketPath: "/tmp/anchor-a/.ccb/ccbd/ccbd.sock",
        attempts: 1,
        diagnostics: {
          socketPath: "/tmp/anchor-a/.ccb/ccbd/ccbd.sock",
          lastErrorCode: null,
          snapshots: {},
          logTails: {}
        }
      })
    } as never
  });

  const result = await service.start("/tmp/anchor-a");

  assert.equal(result.pid, 12345);
  assert.equal(result.socketPath, "/tmp/anchor-a/.ccb/ccbd/ccbd.sock");
  assert.equal(child.unrefCalled, true);
  const launchCommand = (calls[0] as { args: string[] }).args.at(-1);
  assert.equal(typeof launchCommand, "string");
  assert.match(launchCommand as string, /env -u TMUX -u TMUX_PANE/);
  assert.match(launchCommand as string, /CCB_NO_ATTACH=1/);
  assert.match(launchCommand as string, /CCB_SKIP_STARTUP_UPDATE_CHECK=1/);
  assert.match(launchCommand as string, /ccb/);
  assert.match(launchCommand as string, /--project/);
  assert.deepEqual(calls, [
    {
      command: "tmux",
      args: [
        "-S",
        "/tmp/anchor-a/.ccb/ccbd/launch.sock",
        "new-session",
        "-d",
        "-x",
        "200",
        "-y",
        "60",
        "-s",
        "ccb-anchor-launch",
        "-c",
        "/tmp/anchor-a",
        launchCommand
      ],
      options: { detached: true, stdio: "ignore" }
    }
  ]);
});

const replyLangCases: Array<{
  name: string;
  env: ReplyLangEnv;
  expected: "zh" | "en";
}> = [
  { name: "defaults to zh without env", env: {}, expected: "zh" },
  { name: "uses CCB_REPLY_LANG=en", env: { replyLang: "en" }, expected: "en" },
  { name: "normalizes CCB_REPLY_LANG=english to en", env: { replyLang: "english" }, expected: "en" },
  { name: "falls back to zh for empty CCB_REPLY_LANG", env: { replyLang: "" }, expected: "zh" },
  { name: "falls back to zh for CCB_REPLY_LANG=auto", env: { replyLang: "auto" }, expected: "zh" },
  { name: "falls back to zh for invalid CCB_REPLY_LANG", env: { replyLang: "klingon" }, expected: "zh" },
  { name: "normalizes CCB_REPLY_LANG=cn to zh", env: { replyLang: "cn" }, expected: "zh" },
  { name: "normalizes CCB_REPLY_LANG=chinese to zh", env: { replyLang: "chinese" }, expected: "zh" },
  { name: "uses CCB_LANG=en when CCB_REPLY_LANG is unset", env: { lang: "en" }, expected: "en" },
  { name: "normalizes CCB_LANG=cn to zh when CCB_REPLY_LANG is unset", env: { lang: "cn" }, expected: "zh" },
  {
    name: "normalizes CCB_LANG=chinese to zh when CCB_REPLY_LANG is unset",
    env: { lang: "chinese" },
    expected: "zh"
  },
  { name: "prefers CCB_REPLY_LANG over CCB_LANG", env: { replyLang: "en", lang: "zh" }, expected: "en" }
];

for (const { name, env, expected } of replyLangCases) {
  test(`start injects normalized CCB_REPLY_LANG: ${name}`, async () => {
    await withReplyLangEnv(env, async () => {
      const launchCommand = await captureLaunchCommand();
      assert.match(launchCommand, new RegExp(`CCB_REPLY_LANG=${expected}(\\s|$)`));
    });
  });
}

test("killLaunchSession invokes tmux against the isolated launch socket", async () => {
  const calls: unknown[] = [];
  const service = new CcbdLauncherService({
    execFileProcess: (async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: "killed", stderr: "" };
    }) as never
  });

  const result = await service.killLaunchSession("/tmp/anchor-a");

  assert.deepEqual(result, { stdout: "killed", stderr: "" });
  assert.deepEqual(calls, [
    {
      command: "tmux",
      args: ["-S", "/tmp/anchor-a/.ccb/ccbd/launch.sock", "kill-session", "-t", "ccb-anchor-launch"]
    }
  ]);
});

test("kill invokes ccb --project <anchor> kill through execFile", async () => {
  const calls: unknown[] = [];
  const service = new CcbdLauncherService({
    execFileProcess: (async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: "ok", stderr: "" };
    }) as never
  });

  const result = await service.kill("/tmp/anchor-a");

  assert.deepEqual(result, { stdout: "ok", stderr: "" });
  assert.deepEqual(calls, [{ command: "ccb", args: ["--project", "/tmp/anchor-a", "kill"] }]);
});

test("killLifecyclePids only kills lifecycle pids that belong to the anchor path", async () => {
  const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const service = new CcbdLauncherService({
    readTextFile: async (path) => {
      if (path.endsWith("lifecycle.json")) {
        return JSON.stringify({ keeper_pid: 111, owner_pid: 222 });
      }
      if (path === "/proc/111/cmdline") {
        return "python\0keeper_main.py\0--project\0/tmp/anchor-a\0";
      }
      if (path === "/proc/222/cmdline") {
        return "python\0unrelated.py\0";
      }
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    readLinkPath: async (path) => {
      if (path === "/proc/111/cwd") return "/tmp/anchor-a";
      if (path === "/proc/222/cwd") return "/tmp/not-this-anchor";
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    killPid: (pid, signal) => {
      killed.push({ pid, signal });
    }
  });

  const result = await service.killLifecyclePids("/tmp/anchor-a");

  assert.deepEqual(killed, [{ pid: 111, signal: "SIGTERM" }]);
  assert.deepEqual(result.killed, [111]);
  assert.deepEqual(result.skipped, [{ pid: 222, reason: "pid does not belong to anchor path" }]);
});
