import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { test } from "vitest";

test("SP-B15 schema uses Requirement planning carrier and removes Epic carrier fields", async () => {
  const schema = await readFile(resolve("prisma/schema.prisma"), "utf8");

  assert.match(schema, /currentPlanningStep\s+String\?/);
  assert.match(schema, /planningSubstate\s+String\?/);
  assert.match(schema, /breakdownDraftPath\s+String\?/);
  assert.match(schema, /subjectType\s+String\s+@map\("subject_type"\)/);
  assert.match(schema, /subjectId\s+String\s+@map\("subject_id"\)/);
  assert.match(schema, /mode\s+String\s+@default\("execution"\)/);

  assert.doesNotMatch(schema, /model RequirementMaterialization\b/);
  assert.doesNotMatch(schema, /boundEpicTaskId/);
  assert.doesNotMatch(schema, /parentEpicId/);
  assert.doesNotMatch(schema, /materializationState/);
  assert.doesNotMatch(schema, /epicStatus/);
  assert.doesNotMatch(schema, /kind\s+String\s+@default\("subtask"\)/);
});
