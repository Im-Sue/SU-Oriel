import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AI_CLI_ERROR_CODES, AiCliError } from "../ai-cli/ai-cli.errors.js";
import { CastWriter } from "../ai-cli/ai-cli.recording.js";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_DIR = resolve(SERVER_ROOT, "data", "anchor-terminal", "recordings");

export interface AnchorTerminalRecordingMeta {
  id: string;
  anchorId: string;
  taskId: string | null;
  pane: string;
  source: "anchor";
  cols: number;
  rows: number;
  createdAt: string;
  finishedAt: string | null;
  byteSize: number;
}

export class AnchorTerminalRecordingSession {
  public constructor(
    private readonly store: AnchorTerminalRecordingStore,
    public readonly writer: CastWriter,
    public readonly meta: AnchorTerminalRecordingMeta
  ) {}

  writeOutput(data: string): void {
    this.writer.writeOutput(data);
  }

  async close(): Promise<void> {
    const expectedSize = this.writer.size();
    this.writer.close();
    await waitForFileSize(this.writer.path, expectedSize);
    this.store.finish(this.meta, this.writer.path, expectedSize);
  }
}

export class AnchorTerminalRecordingStore {
  public constructor(private readonly baseDir: string = DEFAULT_DIR) {
    mkdirSync(this.baseDir, { recursive: true });
  }

  start(input: {
    anchorId: string;
    taskId: string | null;
    pane: string;
    cols?: number;
    rows?: number;
  }): AnchorTerminalRecordingSession {
    const createdAt = new Date();
    const id = buildRecordingId(input.anchorId, input.pane);
    const dir = resolve(this.baseDir, safeSegment(input.anchorId));
    const castPath = resolve(dir, `${safeSegment(input.pane)}.cast`);
    const writer = new CastWriter(castPath, {
      version: 2,
      width: input.cols ?? 100,
      height: input.rows ?? 30,
      timestamp: Math.floor(createdAt.getTime() / 1000),
      title: `${input.anchorId} · ${input.pane}`,
      meta: {
        anchorId: input.anchorId,
        taskId: input.taskId,
        pane: input.pane,
        source: "anchor"
      }
    });
    const meta: AnchorTerminalRecordingMeta = {
      id,
      anchorId: input.anchorId,
      taskId: input.taskId,
      pane: input.pane,
      source: "anchor",
      cols: input.cols ?? 100,
      rows: input.rows ?? 30,
      createdAt: createdAt.toISOString(),
      finishedAt: null,
      byteSize: writer.size()
    };
    this.writeMeta(meta);
    return new AnchorTerminalRecordingSession(this, writer, meta);
  }

  finish(meta: AnchorTerminalRecordingMeta, castPath: string, fallbackSize: number): void {
    meta.finishedAt = new Date().toISOString();
    meta.byteSize = existsSync(castPath) ? statSync(castPath).size : fallbackSize;
    this.writeMeta(meta);
  }

  list(filter: { anchorId?: string } = {}): AnchorTerminalRecordingMeta[] {
    const metas = this.readAllMeta();
    const filtered = filter.anchorId ? metas.filter((meta) => meta.anchorId === filter.anchorId) : metas;
    return filtered.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  read(id: string): { meta: AnchorTerminalRecordingMeta; cast: string } {
    const meta = this.readAllMeta().find((item) => item.id === id);
    if (!meta) {
      throw new AiCliError(AI_CLI_ERROR_CODES.RECORDING_NOT_FOUND, "未找到指定的 anchor 终端录像");
    }
    const castPath = this.castPathFor(meta.anchorId, meta.pane);
    if (!existsSync(castPath)) {
      throw new AiCliError(AI_CLI_ERROR_CODES.RECORDING_NOT_FOUND, "未找到指定的 anchor 终端录像");
    }
    return {
      meta,
      cast: readFileSync(castPath, "utf8")
    };
  }

  pipeOutputPath(anchorId: string, pane: string): string {
    const path = resolve(this.baseDir, "..", "pipes", safeSegment(anchorId), `${safeSegment(pane)}.pipe.log`);
    mkdirSync(dirname(path), { recursive: true });
    return path;
  }

  private castPathFor(anchorId: string, pane: string): string {
    return resolve(this.baseDir, safeSegment(anchorId), `${safeSegment(pane)}.cast`);
  }

  private metaPathFor(anchorId: string, pane: string): string {
    return resolve(this.baseDir, safeSegment(anchorId), `${safeSegment(pane)}.meta.json`);
  }

  private writeMeta(meta: AnchorTerminalRecordingMeta): void {
    const path = this.metaPathFor(meta.anchorId, meta.pane);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(meta, null, 2));
  }

  private readAllMeta(): AnchorTerminalRecordingMeta[] {
    const results: AnchorTerminalRecordingMeta[] = [];
    for (const anchorDir of readdirSafe(this.baseDir)) {
      const dir = resolve(this.baseDir, anchorDir);
      for (const entry of readdirSafe(dir)) {
        if (!entry.endsWith(".meta.json")) {
          continue;
        }
        try {
          results.push(JSON.parse(readFileSync(resolve(dir, entry), "utf8")) as AnchorTerminalRecordingMeta);
        } catch {
          // ignore bad recording metadata
        }
      }
    }
    return results;
  }
}

function buildRecordingId(anchorId: string, pane: string): string {
  return `${safeSegment(anchorId)}--${safeSegment(pane)}`;
}

function safeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_") || "unknown";
}

function readdirSafe(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

async function waitForFileSize(path: string, expectedSize: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 500) {
    const size = await stat(path).then((item) => item.size).catch(() => 0);
    if (size >= expectedSize) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
