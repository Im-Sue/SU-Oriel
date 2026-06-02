/**
 * Vitest globalSetup: 准备隔离的 test.db
 *
 * 解决 pre-existing 问题：scheduler.service.spec.ts 等多个 spec 用
 * prisma.task.deleteMany() 不带 where filter 会清掉 dev.db 全表。
 * 现在 vitest 跑时 prisma.ts 会自动指向 test.db (见 db/prisma.ts)，
 * 本 setup 确保 test.db 存在且 schema 与 prisma/schema.prisma 同步。
 */

import { execSync } from "node:child_process";
import { existsSync, copyFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const devDbPath = resolve(serverRoot, "prisma/dev.db");
const testDbPath = resolve(serverRoot, "prisma/test.db");

export async function setup() {
  // 强制 set env 让 worker 内 prisma.ts 走 test.db 路径
  process.env.DATABASE_URL = `file:${testDbPath}`;
  process.env.VITEST = "1";

  // 优先：从 dev.db copy 一份 schema-only baseline 给 test.db
  // 这样跳过 prisma db push（快）
  for (const path of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
  if (existsSync(devDbPath)) {
    execSync(
      `python3 -c "import sqlite3; c=sqlite3.connect('${devDbPath}'); c.execute('PRAGMA wal_checkpoint(FULL)'); c.close()"`,
      { stdio: "pipe" }
    );
    copyFileSync(devDbPath, testDbPath);
    // 清空数据，保留 schema
    try {
      execSync(
        `python3 -c "import sqlite3; c=sqlite3.connect('${testDbPath}'); ` +
          `tables=[r[0] for r in c.execute(\\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'\\").fetchall()]; ` +
          `[c.execute(f'DELETE FROM \\"{t}\\"') for t in tables]; c.commit()"`,
        { stdio: "pipe" }
      );
    } catch {
      // 静默失败，让测试自己 init
    }
  } else {
    // dev.db 不存在 → 用 prisma db push 直接初始化 test.db
    execSync(`pnpm prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss`, {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
      stdio: "pipe"
    });
  }
}

export async function teardown() {
  // 留在原地方便 debug；下次 setup 会重置
}
