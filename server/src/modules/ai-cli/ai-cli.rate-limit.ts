import { AI_CLI_ERROR_CODES, AiCliError } from "./ai-cli.errors.js";

interface Bucket {
  windowStart: number;
  count: number;
}

/**
 * 简易固定窗口限流：单 key 每 windowMs 内最多 max 次。
 * key 通常用 `${ip}:${action}`，避免按钮被误点把屏幕填满终端窗口。
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  public constructor(
    private readonly windowMs: number,
    private readonly max: number
  ) {}

  public check(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { windowStart: now, count: 1 });
      this.cleanupIfLarge(now);
      return;
    }

    bucket.count += 1;
    if (bucket.count > this.max) {
      const retryAfterSec = Math.ceil((this.windowMs - (now - bucket.windowStart)) / 1000);
      throw new AiCliError(
        AI_CLI_ERROR_CODES.RATE_LIMITED,
        `操作过于频繁，请 ${retryAfterSec} 秒后再试`,
        429
      );
    }
  }

  private cleanupIfLarge(now: number): void {
    if (this.buckets.size < 256) {
      return;
    }
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
