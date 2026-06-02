import { readFile, writeFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

import type { PipeOutputSource } from "./types.js";

const DEFAULT_POLL_MS = 250;

export class FileTailPipeOutputSource implements PipeOutputSource {
  private readonly decoder = new StringDecoder("utf8");
  private readonly timer: NodeJS.Timeout;
  private offset = 0;
  private closed = false;
  private reading = false;
  private dataHandlers: Array<(chunk: string) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];

  private constructor(private readonly path: string, pollMs: number) {
    this.timer = setInterval(() => {
      void this.poll();
    }, pollMs);
  }

  static async open(path: string, pollMs = DEFAULT_POLL_MS): Promise<FileTailPipeOutputSource> {
    await writeFile(path, "");
    return new FileTailPipeOutputSource(path, pollMs);
  }

  onData(handler: (chunk: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    const tail = this.decoder.end();
    if (tail) {
      this.emitData(tail);
    }
  }

  private async poll(): Promise<void> {
    if (this.closed || this.reading) {
      return;
    }
    this.reading = true;
    try {
      const content = await readFile(this.path);
      if (content.length < this.offset) {
        this.offset = 0;
      }
      if (content.length > this.offset) {
        const chunk = content.subarray(this.offset);
        this.offset = content.length;
        const decoded = this.decoder.write(chunk);
        if (decoded) {
          this.emitData(decoded);
        }
      }
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.reading = false;
    }
  }

  private emitData(chunk: string): void {
    for (const handler of this.dataHandlers) {
      handler(chunk);
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }
}
