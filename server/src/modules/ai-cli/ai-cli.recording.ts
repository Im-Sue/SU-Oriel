import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, createWriteStream, existsSync, unlinkSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AI_CLI_ERROR_CODES, AiCliError } from "./ai-cli.errors.js";
import type { AiCliToolId } from "./ai-cli.types.js";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_DIR = resolve(SERVER_ROOT, "data", "ai-cli", "recordings");

export interface RecordingMeta {
  id: string;
  toolId: AiCliToolId;
  projectId: string | null;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  finishedAt: string | null;
  byteSize: number;
}

export interface RecordingHeader {
  version: 2;
  width: number;
  height: number;
  timestamp: number;
  env?: Record<string, string>;
  title?: string;
  meta?: Record<string, unknown>;
}

export class CastWriter {
  private readonly stream: WriteStream;
  private readonly start: number;
  private byteSize = 0;

  public constructor(public readonly path: string, public readonly header: RecordingHeader) {
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { flags: "w", encoding: "utf8" });
    this.start = header.timestamp * 1000;
    const headerLine = JSON.stringify(header) + "\n";
    this.stream.write(headerLine);
    this.byteSize += Buffer.byteLength(headerLine, "utf8");
  }

  public writeOutput(data: string): void {
    const elapsed = (Date.now() - this.start) / 1000;
    const event = JSON.stringify([Number(elapsed.toFixed(6)), "o", data]) + "\n";
    this.stream.write(event);
    this.byteSize += Buffer.byteLength(event, "utf8");
  }

  public writeInput(data: string): void {
    const elapsed = (Date.now() - this.start) / 1000;
    const event = JSON.stringify([Number(elapsed.toFixed(6)), "i", data]) + "\n";
    this.stream.write(event);
    this.byteSize += Buffer.byteLength(event, "utf8");
  }

  public size(): number {
    return this.byteSize;
  }

  public close(): void {
    this.stream.end();
  }
}

export class RecordingStore {
  public constructor(private readonly baseDir: string = DEFAULT_DIR) {
    mkdirSync(this.baseDir, { recursive: true });
  }

  public newWriter(input: {
    sessionId: string;
    toolId: AiCliToolId;
    projectId: string | null;
    cwd: string;
    cols: number;
    rows: number;
    title: string;
  }): { writer: CastWriter; meta: RecordingMeta } {
    const id = input.sessionId;
    const path = resolve(this.baseDir, `${id}.cast`);
    const createdAt = new Date();
    const writer = new CastWriter(path, {
      version: 2,
      width: input.cols,
      height: input.rows,
      timestamp: Math.floor(createdAt.getTime() / 1000),
      title: input.title,
      meta: {
        toolId: input.toolId,
        projectId: input.projectId,
        cwd: input.cwd
      }
    });
    const meta: RecordingMeta = {
      id,
      toolId: input.toolId,
      projectId: input.projectId,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      createdAt: createdAt.toISOString(),
      finishedAt: null,
      byteSize: writer.size()
    };
    this.writeMeta(meta);
    return { writer, meta };
  }

  public finish(meta: RecordingMeta, byteSize: number): void {
    meta.finishedAt = new Date().toISOString();
    meta.byteSize = byteSize;
    this.writeMeta(meta);
  }

  public list(filter?: { projectId?: string | null }): RecordingMeta[] {
    const entries = readdirSync(this.baseDir).filter((name) => name.endsWith(".meta.json"));
    const results: RecordingMeta[] = [];
    for (const entry of entries) {
      try {
        const raw = readFileSync(resolve(this.baseDir, entry), "utf8");
        const parsed = JSON.parse(raw) as RecordingMeta;
        if (filter?.projectId !== undefined && parsed.projectId !== filter.projectId) {
          continue;
        }
        results.push(parsed);
      } catch {
        // 忽略坏文件
      }
    }
    results.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return results;
  }

  public read(id: string): { meta: RecordingMeta; cast: string } {
    const metaPath = resolve(this.baseDir, `${id}.meta.json`);
    const castPath = resolve(this.baseDir, `${id}.cast`);
    if (!existsSync(metaPath) || !existsSync(castPath)) {
      throw new AiCliError(AI_CLI_ERROR_CODES.RECORDING_NOT_FOUND, "未找到指定的会话录像");
    }
    let meta: RecordingMeta;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8")) as RecordingMeta;
    } catch {
      throw new AiCliError(AI_CLI_ERROR_CODES.RECORDING_INVALID, "录像元数据已损坏");
    }
    const cast = readFileSync(castPath, "utf8");
    return { meta, cast };
  }

  public delete(id: string): void {
    const metaPath = resolve(this.baseDir, `${id}.meta.json`);
    const castPath = resolve(this.baseDir, `${id}.cast`);
    if (existsSync(metaPath)) {
      unlinkSync(metaPath);
    }
    if (existsSync(castPath)) {
      unlinkSync(castPath);
    }
  }

  public statSize(id: string): number {
    const castPath = resolve(this.baseDir, `${id}.cast`);
    if (!existsSync(castPath)) {
      return 0;
    }
    return statSync(castPath).size;
  }

  private writeMeta(meta: RecordingMeta): void {
    writeFileSync(resolve(this.baseDir, `${meta.id}.meta.json`), JSON.stringify(meta, null, 2));
  }
}

export const sharedRecordingStore = new RecordingStore();
