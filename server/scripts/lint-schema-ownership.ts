#!/usr/bin/env tsx
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatSchemaOwnershipReport,
  runSchemaOwnershipLint,
  type LintMode
} from "../src/maintenance/schema-ownership-lint.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode: LintMode = args.includes("--report") ? "report" : "check";
  const cwd = process.cwd();
  const result = await runSchemaOwnershipLint({
    matrixPath: resolve(cwd, "../references/schema-ownership-matrix.yaml"),
    schemaPath: resolve(cwd, "prisma/schema.prisma"),
    // repo-local：su-oriel 只扫自身 server/src + prisma + matrix，证明 Console 不越权写 DB。
    // 跨仓校验（plugin lib 的 schema ownership）移至根仓库 umbrella 脚本，不在单仓 CI 强依赖 sibling。
    sourceRoots: [resolve(cwd, "src")],
    mode
  });
  console.log(formatSchemaOwnershipReport(result));
  if (mode === "check" && result.failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
