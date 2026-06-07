import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { test } from "vitest";

import { buildManagedCcbConfig, projectSlotTopology } from "../modules/project-ccbd/managed-config.service.js";

const execFileAsync = promisify(execFile);
const scriptPath = resolve(process.cwd(), "scripts/lint_main_anchor_config.py");

async function runLint(configText: string) {
  const projectRoot = await mkdtemp(join(tmpdir(), "main-anchor-config-lint-"));
  try {
    await mkdir(join(projectRoot, ".ccb"), { recursive: true });
    await writeFile(join(projectRoot, ".ccb", "ccb.config"), configText, "utf8");
    return await execFileAsync("python3", [scriptPath], {
      env: {
        ...process.env,
        CCB_PROJECT_ROOT: projectRoot
      }
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function managedConfig(slotCount: number): string {
  return buildManagedCcbConfig(projectSlotTopology(slotCount));
}

test("main anchor config lint accepts contiguous 3-slot and 4-slot managed configs", async () => {
  for (const slotCount of [3, 4]) {
    const result = await runLint(managedConfig(slotCount));

    assert.match(result.stdout, /main anchor config lint passed/);
  }
});

test("main anchor config lint rejects malformed non-contiguous slot windows", async () => {
  const malformed = managedConfig(4).replace('slot-3 = "slot3_claude:claude; slot3_codex:codex"\n', "");

  await assert.rejects(
    runLint(malformed),
    (error: unknown) => {
      const failure = error as { code?: number; stderr?: string };
      assert.notEqual(failure.code, 0);
      assert.match(String(failure.stderr), /contiguous slot-1\.\.slot-4/);
      return true;
    }
  );
});
