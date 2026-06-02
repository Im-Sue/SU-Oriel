import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Options {
  backup: boolean;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, "..");
const devDbPath = resolve(serverRoot, "prisma/dev.db");
const sidecarPaths = [`${devDbPath}-wal`, `${devDbPath}-shm`];

function parseOptions(argv: string[]): Options {
  const options: Options = { backup: true };
  for (const arg of argv) {
    if (arg === "--no-backup") options.backup = false;
    else if (arg === "--no-seed" || arg === "--with-demo") {
      console.log(`[db:rehydrate] ${arg} ignored after v1.0 clean start`);
    }
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: pnpm db:rehydrate [--no-backup]`);
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
}

function devDbEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, DATABASE_URL: `file:${devDbPath}` };
  delete env.VITEST;
  delete env.VITEST_POOL_ID;
  delete env.VITEST_WORKER_ID;
  if (env.NODE_ENV === "test") env.NODE_ENV = "development";
  return env;
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: serverRoot,
      env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit ${code}`}`));
      }
    });
  });
}

async function backupDevDb(enabled: boolean): Promise<string | null> {
  if (!enabled) {
    console.log("[db:rehydrate] backup skipped (--no-backup)");
    return null;
  }
  if (!existsSync(devDbPath)) {
    console.log("[db:rehydrate] no dev.db found; backup skipped");
    return null;
  }

  await checkpointDevDb();
  const backupPath = `${devDbPath}.bak-${timestamp()}`;
  await copyFile(devDbPath, backupPath);
  console.log(`[db:rehydrate] backed up dev.db -> ${backupPath}`);
  return backupPath;
}

async function checkpointDevDb(): Promise<void> {
  await run("python3", [
    "-c",
    "import sqlite3, sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA wal_checkpoint(FULL)'); c.close()",
    devDbPath
  ]);
}

async function removeDevDb(): Promise<void> {
  for (const path of [devDbPath, ...sidecarPaths]) {
    try {
      await unlink(path);
      console.log(`[db:rehydrate] removed ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function syncCurrentSchema(): Promise<void> {
  await run(
    "pnpm",
    ["prisma", "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate", "--force-reset", "--accept-data-loss"],
    devDbEnv()
  );
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  await backupDevDb(options.backup);
  await removeDevDb();
  await syncCurrentSchema();
  await run("pnpm", ["run", "prisma:generate"], devDbEnv());

  console.log("[db:rehydrate] done");
}

main().catch((error) => {
  console.error("[db:rehydrate] failed:", error);
  process.exit(1);
});
