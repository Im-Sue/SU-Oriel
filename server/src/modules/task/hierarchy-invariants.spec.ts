import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { test } from "vitest";

test("ADR-0028 retired epic hierarchy fields from Task schema", async () => {
  const schema = await readFile(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
  const taskModel = schema.match(/model Task \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(taskModel.includes("requirementId"));
  assert.doesNotMatch(taskModel, /\bkind\b/);
  assert.doesNotMatch(taskModel, /\bparentEpicId\b/);
  assert.doesNotMatch(taskModel, /\bepicStatus\b/);
});
