import assert from "node:assert/strict";

import { test } from "vitest";

import {
  MANAGED_AGENT_NAMES,
  MANAGED_WINDOW_NAMES
} from "../project-ccbd/managed-config.service.js";
import {
  agentCore,
  agentNamesForSlot,
  managedAgentNames,
  managedWindowNames,
  slotIds
} from "./slot-topology.service.js";

test("slotCount 3 topology matches the current managed config constants", () => {
  assert.deepEqual(slotIds(3), ["slot-1", "slot-2", "slot-3"]);
  assert.deepEqual(managedWindowNames(3), [...MANAGED_WINDOW_NAMES]);
  assert.deepEqual(managedAgentNames(3), [...MANAGED_AGENT_NAMES]);
  assert.deepEqual(agentCore(3), {
    main_claude: { provider: "claude", windowName: "main" },
    main_codex: { provider: "codex", windowName: "main" },
    slot1_claude: { provider: "claude", windowName: "slot-1" },
    slot1_codex: { provider: "codex", windowName: "slot-1" },
    slot2_claude: { provider: "claude", windowName: "slot-2" },
    slot2_codex: { provider: "codex", windowName: "slot-2" },
    slot3_claude: { provider: "claude", windowName: "slot-3" },
    slot3_codex: { provider: "codex", windowName: "slot-3" }
  });
});

test("slot topology derives 1, 4, and 16 slot shapes", () => {
  assert.deepEqual(slotIds(1), ["slot-1"]);
  assert.deepEqual(managedWindowNames(1), ["main", "slot-1"]);
  assert.deepEqual(managedAgentNames(1), ["main_claude", "main_codex", "slot1_claude", "slot1_codex"]);

  assert.deepEqual(slotIds(4), ["slot-1", "slot-2", "slot-3", "slot-4"]);
  assert.deepEqual(agentNamesForSlot("slot-4"), ["slot4_claude", "slot4_codex"]);
  assert.equal(agentCore(4).slot4_claude?.windowName, "slot-4");
  assert.equal(agentCore(4).slot4_codex?.provider, "codex");

  const sixteenSlotIds = slotIds(16);
  assert.equal(sixteenSlotIds.length, 16);
  assert.equal(sixteenSlotIds.at(-1), "slot-16");
  assert.deepEqual(agentNamesForSlot("slot-16"), ["slot16_claude", "slot16_codex"]);
  assert.equal(managedWindowNames(16).length, 17);
  assert.equal(managedAgentNames(16).length, 34);
});

test("slot topology rejects slotCount and slotId outside the supported range", () => {
  for (const slotCount of [0, 17, -1, 1.5, Number.NaN]) {
    assert.throws(() => slotIds(slotCount), /slotCount must be an integer between 1 and 16/);
    assert.throws(() => managedWindowNames(slotCount), /slotCount must be an integer between 1 and 16/);
    assert.throws(() => managedAgentNames(slotCount), /slotCount must be an integer between 1 and 16/);
    assert.throws(() => agentCore(slotCount), /slotCount must be an integer between 1 and 16/);
  }
  for (const slotId of ["slot-0", "slot-17", "slot-x", "main"]) {
    assert.throws(() => agentNamesForSlot(slotId), /slotId must be in slot-1..slot-16/);
  }
});
