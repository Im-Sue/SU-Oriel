import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnchorTerminalAuditWriter } from "./audit-writer.js";

describe("anchor-terminal audit writer", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("aggregates accepted input into metadata-only jsonl records", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-audit-"));
    const writer = new AnchorTerminalAuditWriter({ auditDir: tempDir, flushIntervalMs: 10_000, flushBytes: 8_192 });

    writer.recordInput({
      anchorId: "anchor_task_1",
      pane: "ccb_claude",
      clientId: "client-a",
      remoteAddr: "127.0.0.1",
      data: "hello"
    });
    writer.recordInput({
      anchorId: "anchor_task_1",
      pane: "ccb_claude",
      clientId: "client-a",
      remoteAddr: "127.0.0.1",
      data: "\u0003"
    });
    await writer.flush();

    const jsonl = await readFile(join(tempDir, "anchor_task_1.jsonl"), "utf8");
    const rows = jsonl.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      anchorId: "anchor_task_1",
      pane: "ccb_claude",
      clientId: "client-a",
      remoteAddr: "127.0.0.1",
      frame_count: 2,
      bytes: Buffer.byteLength("hello\u0003"),
      sha256: createHash("sha256").update("hello\u0003").digest("hex"),
      first_at: expect.any(String),
      last_at: expect.any(String)
    });
    expect(jsonl).not.toContain("hello");
  });

  it("flushes buffered metadata on interval and on close", async () => {
    vi.useFakeTimers();
    tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-audit-"));
    const writer = new AnchorTerminalAuditWriter({ auditDir: tempDir, flushIntervalMs: 250, flushBytes: 8_192 });

    writer.recordInput({
      anchorId: "anchor_task_2",
      pane: "ccb_codex",
      clientId: "client-b",
      remoteAddr: "::1",
      data: "abc"
    });
    expect(existsSync(join(tempDir, "anchor_task_2.jsonl"))).toBe(false);

    await vi.advanceTimersByTimeAsync(250);
    await writer.close();

    const jsonl = await readFile(join(tempDir, "anchor_task_2.jsonl"), "utf8");
    const row = JSON.parse(jsonl.trim()) as Record<string, unknown>;
    expect(row).toMatchObject({
      anchorId: "anchor_task_2",
      pane: "ccb_codex",
      clientId: "client-b",
      frame_count: 1,
      bytes: 3
    });
  });
});
