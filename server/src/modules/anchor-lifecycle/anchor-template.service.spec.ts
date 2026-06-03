import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import { buildAnchorConfig, writeAnchorConfig } from "./anchor-template.service.js";

let tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tmpRoots.map((path) => rm(path, { recursive: true, force: true })));
  tmpRoots = [];
});

test("buildAnchorConfig emits managed v7 multi-window slot topology without legacy layout", () => {
  const config = buildAnchorConfig();

  assert.match(config, /\[windows]/);
  assert.match(config, /main = "main_claude:claude; main_codex:codex"/);
  assert.match(config, /slot-3 = "slot3_claude:claude; slot3_codex:codex"/);
  assert.match(config, /\[agents\.main_claude\]/);
  assert.match(config, /\[agents\.slot3_codex\]/);
  assert.doesNotMatch(config, /\[agents\.slot4_/);
  assert.doesNotMatch(config, /\[agents\.slot5_/);
  assert.doesNotMatch(config, /task_auto_/);
  assert.doesNotMatch(config, /^default_agents\s*=/m);
  assert.doesNotMatch(config, /^layout\s*=/m);
  assert.doesNotMatch(config, /^\[ui\.sidebar\.view]$/m);
  assert.equal((config.match(/workspace_mode = "inplace"/g) ?? []).length, 8);
});

test("writeAnchorConfig creates .ccb/ccb.config under the anchor root", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccb-anchor-template-"));
  tmpRoots.push(root);

  const configPath = await writeAnchorConfig(root);

  assert.equal(configPath, join(root, ".ccb", "ccb.config"));
  const config = await readFile(configPath, "utf8");
  assert.match(config, /\[agents\.main_claude\]/);
  assert.match(config, /\[agents\.slot3_codex\]/);
  assert.doesNotMatch(config, /\[agents\.slot4_/);
  assert.doesNotMatch(config, /\[agents\.slot5_/);
  assert.doesNotMatch(config, /task_auto_/);
  assert.doesNotMatch(config, /^\[ui\.sidebar\.view]$/m);
});
