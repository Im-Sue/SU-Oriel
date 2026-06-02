import assert from "node:assert/strict";

import { test } from "vitest";

import { getExplicitRequirementStatus, normalizeRequirementFields } from "./document-parser.js";

test("normalizeRequirementFields defaults to SP-B15 drafting status", () => {
  const normalized = normalizeRequirementFields({});

  assert.equal(normalized.status, "drafting");
  assert.equal(normalized.outputMode, "requirement_only");
  assert.equal("splitMode" in normalized, false);
  assert.equal("generatedTaskId" in normalized, false);
});

test("normalizeRequirementFields rejects legacy draft status and epic split projection", () => {
  const normalized = normalizeRequirementFields({
    status: "draft",
    split_mode: "epic_multi_pr",
    generated_task_id: "task-legacy"
  });

  assert.equal(normalized.status, "drafting");
  assert.match(normalized.issues.join("\n"), /非法 status='draft'/);
  assert.equal("splitMode" in normalized, false);
  assert.equal("generatedTaskId" in normalized, false);
});

test("getExplicitRequirementStatus only returns explicit legal status", () => {
  assert.equal(getExplicitRequirementStatus({}), null);
  assert.equal(getExplicitRequirementStatus({ status: "draft" }), null);
  assert.equal(getExplicitRequirementStatus({ status: " delivered " }), "delivered");
});
