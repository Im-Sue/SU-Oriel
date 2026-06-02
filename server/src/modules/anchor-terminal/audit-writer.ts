import { createHash } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_AUDIT_DIR = resolve(SERVER_ROOT, "data", "anchor-terminal", "audit");
const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_FLUSH_BYTES = 8 * 1024;

export interface AnchorTerminalAuditInput {
  anchorId: string;
  pane: string;
  clientId: string;
  remoteAddr: string;
  data: string;
}

export interface AnchorTerminalAuditWriterOptions {
  auditDir?: string;
  flushIntervalMs?: number;
  flushBytes?: number;
}

interface AuditBuffer {
  anchorId: string;
  pane: string;
  clientId: string;
  remoteAddr: string;
  chunks: string[];
  frameCount: number;
  bytes: number;
  firstAt: string;
  lastAt: string;
  timer: NodeJS.Timeout | null;
}

export class AnchorTerminalAuditWriter {
  private readonly auditDir: string;
  private readonly flushIntervalMs: number;
  private readonly flushBytes: number;
  private readonly buffers = new Map<string, AuditBuffer>();
  private readonly pendingFlushes = new Set<Promise<void>>();
  private closed = false;

  constructor(options: AnchorTerminalAuditWriterOptions = {}) {
    this.auditDir = options.auditDir ?? DEFAULT_AUDIT_DIR;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.flushBytes = options.flushBytes ?? DEFAULT_FLUSH_BYTES;
  }

  recordInput(input: AnchorTerminalAuditInput): void {
    if (this.closed || !input.data) {
      return;
    }
    const key = auditKey(input.anchorId, input.pane, input.clientId);
    const now = new Date().toISOString();
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = {
        anchorId: input.anchorId,
        pane: input.pane,
        clientId: input.clientId,
        remoteAddr: input.remoteAddr,
        chunks: [],
        frameCount: 0,
        bytes: 0,
        firstAt: now,
        lastAt: now,
        timer: null
      };
      this.buffers.set(key, buffer);
      this.scheduleFlush(key, buffer);
    }
    buffer.remoteAddr = input.remoteAddr;
    buffer.chunks.push(input.data);
    buffer.frameCount += 1;
    buffer.bytes += Buffer.byteLength(input.data, "utf8");
    buffer.lastAt = now;
    if (buffer.bytes >= this.flushBytes) {
      this.enqueueFlush(key);
    }
  }

  async flush(): Promise<void> {
    const keys = [...this.buffers.keys()];
    for (const key of keys) {
      this.enqueueFlush(key);
    }
    if (this.pendingFlushes.size > 0) {
      await Promise.all([...this.pendingFlushes]);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  private scheduleFlush(key: string, buffer: AuditBuffer): void {
    buffer.timer = setTimeout(() => {
      this.enqueueFlush(key);
    }, this.flushIntervalMs);
    buffer.timer.unref?.();
  }

  private enqueueFlush(key: string): void {
    const pending = this.flushKey(key);
    this.pendingFlushes.add(pending);
    void pending.finally(() => {
      this.pendingFlushes.delete(pending);
    });
  }

  private async flushKey(key: string): Promise<void> {
    const buffer = this.buffers.get(key);
    if (!buffer) {
      return;
    }
    this.buffers.delete(key);
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    const data = buffer.chunks.join("");
    const row = {
      anchorId: buffer.anchorId,
      pane: buffer.pane,
      clientId: buffer.clientId,
      remoteAddr: buffer.remoteAddr,
      frame_count: buffer.frameCount,
      bytes: buffer.bytes,
      sha256: createHash("sha256").update(data).digest("hex"),
      first_at: buffer.firstAt,
      last_at: buffer.lastAt
    };
    const path = resolve(this.auditDir, `${safeSegment(buffer.anchorId)}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(row)}\n`, "utf8");
  }
}

function auditKey(anchorId: string, pane: string, clientId: string): string {
  return `${anchorId}:${pane}:${clientId}`;
}

function safeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_") || "unknown";
}
