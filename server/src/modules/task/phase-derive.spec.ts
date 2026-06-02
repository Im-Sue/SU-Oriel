import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { mapNodeToPhase } from "./phase-derive.js";

describe("mapNodeToPhase", () => {
  const cases = [
    ["requirement_analysis", "需求"],
    ["technical_design", "设计"],
    ["task_breakdown", "拆分"],
    ["dispatch", "派工"],
    ["implementation", "实施"],
    ["review", "审查"],
    ["archive", "归档"]
  ] as const;

  for (const [node, phase] of cases) {
    test(`${node} maps to ${phase}`, () => {
      assert.equal(mapNodeToPhase(node), phase);
    });
  }
});
