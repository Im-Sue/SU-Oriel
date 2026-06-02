import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { CcbdLauncherService } from "./ccbd-launcher.service.js";

const runRealCcb = process.env.CCB_E2E_REAL_CCB === "1";
const gatedTest = runRealCcb ? test : test.skip;

gatedTest(
  "real ccb launcher starts an anchor ccbd socket",
  async () => {
    const configuredPath = process.env.CCB_E2E_REAL_CCB_ANCHOR_PATH;
    const anchorPath = configuredPath ?? await mkdtemp(join(tmpdir(), "ccb-real-anchor-"));
    const shouldRemove = !configuredPath;
    const launcher = new CcbdLauncherService({
      readinessTimeoutMs: Number(process.env.CCB_E2E_REAL_CCB_TIMEOUT_MS ?? 60_000)
    });

    try {
      const result = await launcher.start(anchorPath);

      assert.ok(result.socketPath);
      assert.match(result.socketPath, /ccbd\.sock$/);
    } finally {
      await launcher.kill(anchorPath).catch(() => undefined);
      await launcher.killLaunchSession(anchorPath).catch(() => undefined);
      await launcher.killLifecyclePids(anchorPath).catch(() => undefined);
      if (shouldRemove) {
        await rm(anchorPath, { recursive: true, force: true });
      }
    }
  },
  70_000
);
