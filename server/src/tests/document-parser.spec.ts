import assert from "node:assert/strict";

import { test } from "vitest";

import { parseDocument } from "../indexer/document-parser.js";

test("parseDocument prefers frontmatter task_id over a dated dev_task filename", () => {
  const parsed = parseDocument({
    relativePath: "docs/03_开发计划/2026-05-12-st1-rich-config-slot-schema-开发任务.md",
    mtime: new Date("2026-05-15T00:00:00.000Z"),
    content: `---
doc_type: dev_task
task_id: st1-rich-config-slot-schema
title: ST1
status: archived
---

# ST1
`
  });

  assert.equal(parsed.taskKey, "st1-rich-config-slot-schema");
});

test("parseDocument reads snake_case task_key before falling back to a dated dev_task filename", () => {
  const parsed = parseDocument({
    relativePath: "docs/03_开发计划/2026-05-12-st2-slot-allocator-ccbd-integration-开发任务.md",
    mtime: new Date("2026-05-15T00:00:00.000Z"),
    content: `---
doc_type: dev_task
task_key: st2-slot-allocator-ccbd-integration
title: ST2
status: archived
---

# ST2
`
  });

  assert.equal(parsed.taskKey, "st2-slot-allocator-ccbd-integration");
});

test("parseDocument infers requirement doc_type from docs structure contract", () => {
  const parsed = parseDocument({
    relativePath: "docs/02_需求设计/checkout-需求.md",
    mtime: new Date("2026-05-27T00:00:00.000Z"),
    content: `---
id: req-checkout
title: Checkout Requirement
status: drafting
---

# Checkout Requirement
`
  });

  assert.equal(parsed.kind, "requirement");
});

test("parseDocument does not infer legacy machine plan/task/decision kinds", () => {
  const parsed = parseDocument({
    relativePath: "docs/.ccb/plans/active/checkout.md",
    mtime: new Date("2026-05-29T00:00:00.000Z"),
    content: `---
kind: plan
task_id: legacy-plan
title: Legacy Plan
---

# Legacy Plan
`
  });

  assert.equal(parsed.kind, "other");
});

test("parseDocument recognizes dev_task in docs/03 when doc_type is explicit", () => {
  const parsed = parseDocument({
    relativePath: "docs/03_开发计划/checkout-a1b2c3-开发任务.md",
    mtime: new Date("2026-05-27T00:00:00.000Z"),
    content: `---
doc_type: dev_task
task_id: subtask-a1b2c3d4e5f6
title: Checkout Dev Task
status: reviewing
current_node: dispatch
node_substate: awaiting_codex_pickup
priority: high
requirement_id: req-checkout
section_id: pr1-checkout
order: 1
implementation_owner: ccb_codex
dependencies: []
source_breakdown_draft: docs/.ccb/drafts/breakdown/req-checkout.json
source_draft_hash: ${"a".repeat(64)}
created_at: 2026-05-27T00:00:00.000Z
---

# Checkout Dev Task

- Implement checkout flow with enough detail for validation.
- Keep the task independently reviewable.
`
  });

  assert.equal(parsed.kind, "dev_task");
  assert.equal(parsed.taskKey, "subtask-a1b2c3d4e5f6");
  assert.equal(parsed.parseStatus, "success");
});

test("parseDocument marks unclosed fenced frontmatter as parse_error", () => {
  const parsed = parseDocument({
    relativePath: "docs/03_开发计划/subtask-bad-frontmatter-开发任务.md",
    mtime: new Date("2026-05-22T00:00:00.000Z"),
    content: `---
doc_type: dev_task
task_id: subtask-bad-frontmatter

# Missing closing delimiter
`
  });

  assert.equal(parsed.parseStatus, "parse_error");
  assert.match(parsed.parseError ?? "", /frontmatter/i);
});

test("parseDocument marks invalid dev_task frontmatter as partial", () => {
  const parsed = parseDocument({
    relativePath: "docs/03_开发计划/subtask-invalid-开发任务.md",
    mtime: new Date("2026-05-22T00:00:00.000Z"),
    content: `---
doc_type: dev_task
task_id: subtask-invalid
title: Invalid Subtask
status: active
current_node: dispatch
node_substate: awaiting_codex_pickup
requirement_id: req-1
section_id: wrong-section
order: 1
implementation_owner: auto
priority: high
dependencies: []
source_breakdown_draft: docs/.ccb/drafts/breakdown/req-1.json
source_draft_hash: ${"a".repeat(64)}
created_at: 2026-05-22T10:00:00.000Z
---

# Invalid Subtask
`
  });

  assert.equal(parsed.parseStatus, "partial");
  assert.match(parsed.parseError ?? "", /implementation_owner/);
  assert.match(parsed.parseError ?? "", /section_id/);
});
