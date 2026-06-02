import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import {
  MANAGED_AGENT_NAMES,
  MANAGED_WINDOW_NAMES,
  ensureManagedCcbConfig,
  renderManagedCcbConfig
} from "./managed-config.service.js";

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
  tmpRoots.length = 0;
});

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ccb-managed-config-"));
  tmpRoots.push(root);
  return root;
}

test("renderManagedCcbConfig emits v7 main plus five slot windows and twelve managed agents", () => {
  const result = renderManagedCcbConfig({
    projectId: "project-1",
    projectRoot: "/repo"
  });

  assert.equal(result.drift?.kind, "missing");
  assert.match(result.configText, /^version = 2$/m);
  assert.match(result.configText, /^entry_window = "main"$/m);
  for (const windowName of MANAGED_WINDOW_NAMES) {
    assert.match(result.configText, new RegExp(`^${windowName.replace("-", "\\-")} = `, "m"));
  }
  for (const agentName of MANAGED_AGENT_NAMES) {
    assert.match(result.configText, new RegExp(`^\\[agents\\.${agentName}]$`, "m"));
  }
  assert.equal((result.configText.match(/workspace_mode = "inplace"/g) ?? []).length, 12);
  assert.equal((result.configText.match(/queue_policy = "serial-per-agent"/g) ?? []).length, 12);
  assert.doesNotMatch(result.configText, /^cmd_enabled\s*=/m);
  assert.doesNotMatch(result.configText, /^default_agents\s*=/m);
  assert.doesNotMatch(result.configText, /^layout\s*=/m);
  assert.doesNotMatch(result.configText, /^\[ui\.sidebar\.view]$/m);
});

test("renderManagedCcbConfig emits sidebar tips with TOML-safe JSON string literals", () => {
  const tips = [
    'slot-1: Quote " and slash \\ 中文',
    "slot-2: Plain"
  ];
  const result = renderManagedCcbConfig({
    projectId: "project-1",
    projectRoot: "/repo",
    sidebarViewTips: tips
  });

  assert.match(result.configText, /^\[ui\.sidebar\.view]$/m);
  assert.match(result.configText, /^tips_enabled = true$/m);
  for (const tip of tips) {
    assert.match(result.configText, new RegExp(`^  ${escapeRegExp(JSON.stringify(tip))},$`, "m"));
  }
});

test("renderManagedCcbConfig emits an empty managed tips array when tips are provided empty", () => {
  const result = renderManagedCcbConfig({
    projectId: "project-1",
    projectRoot: "/repo",
    sidebarViewTips: []
  });

  assert.match(result.configText, /^\[ui\.sidebar\.view]$/m);
  assert.match(result.configText, /^tips = \[]$/m);
});

test("sidebar tips do not affect managed core signature or drift detection", () => {
  const baseline = renderManagedCcbConfig({
    projectId: "project-1",
    projectRoot: "/repo"
  });
  const withTips = renderManagedCcbConfig({
    projectId: "project-1",
    projectRoot: "/repo",
    sidebarViewTips: ["slot-1: Requirement"]
  });
  const existingWithTips = renderManagedCcbConfig({
    projectId: "project-1",
    projectRoot: "/repo",
    existingConfigText: withTips.configText
  });

  assert.equal(withTips.coreSignature, baseline.coreSignature);
  assert.equal(existingWithTips.drift, null);
});

test("renderManagedCcbConfig detects user-edited three-slot core drift", () => {
  const existingConfigText = [
    "version = 2",
    'entry_window = "main"',
    "",
    "[windows]",
    'main = "ccb_claude:claude, ccb_codex:codex"',
    'slot-1 = "slot1_claude:claude, slot1_codex:codex"',
    'slot-2 = "slot2_claude:claude, slot2_codex:codex"',
    'slot-3 = "slot3_claude:claude, slot3_codex:codex"',
    ""
  ].join("\n");

  const result = renderManagedCcbConfig({
    projectId: "project-1",
    projectRoot: "/repo",
    existingConfigText
  });

  assert.equal(result.drift?.kind, "core_drift");
  assert.equal(result.drift?.requiresUserConfirmation, true);
  assert.match(result.drift?.diff ?? "", /slot-4/);
  assert.match(result.drift?.diff ?? "", /slot-5/);
});

test("ensureManagedCcbConfig writes managed config and preserves allowed non-core model fields", async () => {
  const root = await projectRoot();
  const configPath = join(root, ".ccb", "ccb.config");
  await mkdir(join(root, ".ccb"), { recursive: true });
  await writeFile(
    configPath,
    [
      "version = 2",
      'entry_window = "main"',
      "",
      "[windows]",
      'main = "main_claude:claude, main_codex:codex"',
      'slot-1 = "slot1_claude:claude, slot1_codex:codex"',
      'slot-2 = "slot2_claude:claude, slot2_codex:codex"',
      'slot-3 = "slot3_claude:claude, slot3_codex:codex"',
      'slot-4 = "slot4_claude:claude, slot4_codex:codex"',
      'slot-5 = "slot5_claude:claude, slot5_codex:codex"',
      "",
      "[agents.slot3_codex]",
      'provider = "codex"',
      'target = "."',
      'workspace_mode = "inplace"',
      'runtime_mode = "pane-backed"',
      'restore = "auto"',
      'permission = "manual"',
      'queue_policy = "serial-per-agent"',
      'model = "gpt-5-codex"',
      ""
    ].join("\n"),
    "utf8"
  );

  await ensureManagedCcbConfig({
    projectId: "project-1",
    projectRoot: root
  });

  const written = await readFile(configPath, "utf8");
  assert.match(written, /\[agents\.slot3_codex]/);
  assert.match(written, /model = "gpt-5-codex"/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
