import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(currentDir, "..", "..");

function normalizeSqliteDatabaseUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  const rawPath = databaseUrl.slice("file:".length).replace(/\\/g, "/");

  if (rawPath.startsWith("./") || rawPath.startsWith("../")) {
    // 统一把相对路径转换为 server 根目录下的绝对路径，
    // 避免 Prisma 在不同启动目录下解析出错误的数据库位置。
    const absolutePath = resolve(serverRoot, rawPath);
    return `file:${absolutePath.replace(/\\/g, "/")}`;
  }

  return `file:${rawPath}`;
}

// Vitest 环境强制走独立 test.db，避免 deleteMany() 等清表操作污染开发态 dev.db。
// （pre-existing scheduler.service.spec.ts 等用 prisma.task.deleteMany() 不带 where filter）
// 检测 vitest 多个信号：VITEST / VITEST_POOL_ID / VITEST_WORKER_ID / NODE_ENV=test
const isVitest =
  Boolean(process.env.VITEST) ||
  Boolean(process.env.VITEST_POOL_ID) ||
  Boolean(process.env.VITEST_WORKER_ID) ||
  process.env.NODE_ENV === "test";

const explicitTestDbUrl = `file:${resolve(serverRoot, "prisma/test.db").replace(/\\/g, "/")}`;
const explicitDevDbUrl = `file:${resolve(serverRoot, "prisma/dev.db").replace(/\\/g, "/")}`;

if (isVitest) {
  // vitest 强制 test.db，忽略外部 DATABASE_URL 避免污染
  process.env.DATABASE_URL = explicitTestDbUrl;
} else {
  process.env.DATABASE_URL = normalizeSqliteDatabaseUrl(process.env.DATABASE_URL ?? explicitDevDbUrl);
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// SQLite 并发兜底：WAL 让读不再被写阻塞——这正是原始 P1008 的触发点（建项目时后台轮询的
// findMany 读被 indexer 回填的写事务卡住而 socket timeout）；WAL 同时加速写入。busy_timeout
// 给写-写锁等待留足时间。刻意保留 Prisma 默认多连接池，不强制 connection_limit=1：代码有多处
// 交互式 $transaction（含 slot-queue-drain / anchor_dispatch_worker 两个 500ms worker），
// 单连接会引入事务争用（maxWait→P2028）乃至死锁风险。若日后出现写-写 P1008，正解是用 driver
// adapter 把 busy_timeout 设到每条连接，而非回到单连接。
const SQLITE_BUSY_TIMEOUT_MS = Number.parseInt(
  process.env.CCB_SQLITE_BUSY_TIMEOUT_MS ?? "30000",
  10
);

let sqlitePragmaPromise: Promise<void> | null = null;

// 幂等：首次执行 PRAGMA，之后复用同一 promise。
// bootstrap 在启动后台 worker loop 前 await，避免首轮查询跑在 PRAGMA 落库之前。
export function ensureSqlitePragmas(): Promise<void> {
  if (sqlitePragmaPromise) {
    return sqlitePragmaPromise;
  }
  sqlitePragmaPromise = (async () => {
    // journal_mode=WAL 持久化在 DB 文件头，设一次即长期生效。
    // vitest 下跳过，避免改动 test.db 文件格式 / 多 worker 共享行为。
    if (!isVitest) {
      try {
        await prisma.$queryRawUnsafe(`PRAGMA journal_mode = WAL`);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[prisma] failed to set journal_mode=WAL", error);
      }
    }
    if (Number.isFinite(SQLITE_BUSY_TIMEOUT_MS) && SQLITE_BUSY_TIMEOUT_MS > 0) {
      try {
        await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[prisma] failed to set busy_timeout", error);
      }
    }
  })();
  return sqlitePragmaPromise;
}

// 模块加载即触发，尽早把 pragma 落库（bootstrap 仍会 await 以保证顺序）。
void ensureSqlitePragmas();
