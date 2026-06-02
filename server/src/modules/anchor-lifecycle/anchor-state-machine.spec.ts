import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ANCHOR_ALLOWED_TRANSITIONS,
  ANCHOR_TERMINAL_STATES,
  assertAnchorTransition,
  canTransitionAnchor
} from "./anchor-state-machine.js";

test("Anchor lifecycle allows the TA1 happy path into ready and busy", () => {
  assert.ok(ANCHOR_ALLOWED_TRANSITIONS.length >= 8);
  assert.equal(canTransitionAnchor("planned", "worktree_creating"), true);
  assert.equal(canTransitionAnchor("worktree_creating", "configuring"), true);
  assert.equal(canTransitionAnchor("configuring", "mounting"), true);
  assert.equal(canTransitionAnchor("mounting", "ready"), true);
  assert.equal(canTransitionAnchor("ready", "busy"), true);
});

test("Anchor lifecycle rejects skipping cleanup and terminal recovery", () => {
  assert.equal(canTransitionAnchor("ready", "destroyed"), false);
  assert.throws(
    () => assertAnchorTransition("ready", "destroyed"),
    /Anchor transition not allowed: ready -> destroyed/
  );

  assert.deepEqual(ANCHOR_TERMINAL_STATES, ["destroyed"]);
  assert.equal(canTransitionAnchor("destroyed", "recovering"), false);
});

