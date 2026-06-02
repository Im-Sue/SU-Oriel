import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import { cleanupTmpRequirementAssets } from "./requirement-assets.service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function makeProjectRoot() {
  const root = join(tmpdir(), `ccb-req-assets-${randomUUID()}`);
  roots.push(root);
  return root;
}

test("cleanupTmpRequirementAssets removes only stale tmp requirement asset directories when applied", async () => {
  const root = await makeProjectRoot();
  const assetsRoot = join(root, "docs", ".ccb", "assets", "requirements");
  const stale = join(assetsRoot, "tmp-stale");
  const fresh = join(assetsRoot, "tmp-fresh");
  const final = join(assetsRoot, "req-final");
  await mkdir(stale, { recursive: true });
  await mkdir(fresh, { recursive: true });
  await mkdir(final, { recursive: true });
  await writeFile(join(stale, "old.png"), "old");
  await writeFile(join(fresh, "new.png"), "new");
  await writeFile(join(final, "keep.png"), "keep");
  const now = new Date("2026-05-19T12:00:00.000Z");
  const old = new Date(now.getTime() - 49 * 60 * 60 * 1000);
  await Promise.all([utimes(stale, old, old), utimes(fresh, now, now), utimes(final, old, old)]);

  const dryRun = await cleanupTmpRequirementAssets(root, {
    olderThanMs: 48 * 60 * 60 * 1000,
    now,
    apply: false
  });
  assert.deepEqual(dryRun.removedOwners, ["tmp-stale"]);
  assert.deepEqual((await readdir(assetsRoot)).sort(), ["req-final", "tmp-fresh", "tmp-stale"]);

  const applied = await cleanupTmpRequirementAssets(root, {
    olderThanMs: 48 * 60 * 60 * 1000,
    now,
    apply: true
  });
  assert.deepEqual(applied.removedOwners, ["tmp-stale"]);
  assert.deepEqual((await readdir(assetsRoot)).sort(), ["req-final", "tmp-fresh"]);
});
