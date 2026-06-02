import assert from "node:assert/strict";

import { test } from "vitest";

import { validateBreakdownDraft } from "../generated/breakdown-draft-validator.js";
import { validateDevTask } from "../generated/dev-task-validator.js";
import { breakdownDraftSchema } from "../modules/breakdown-draft/breakdown-draft.schema.js";

function validBreakdownDraft() {
  return {
    schema_version: "breakdown-draft-v0.2",
    status: "draft",
    requirement_id: "req-1",
    carrier_task_id: "req-1",
    carrier_task_key: "Generated validator",
    base_task_revision: 0,
    generated_at: "2026-05-22T12:00:00.000Z",
    updated_at: "2026-05-22T12:00:00.000Z",
    generated_by: "ai_session",
    generation_source: {
      cc_agent: "ccb_claude",
      cx_agent: "ccb_codex",
      ccb_job_id: "job_123"
    },
    plan: {
      title: "Plan title",
      summary: "Plan summary",
      spec_outline_md: "## Outline\n\n- Keep the generated validator focused."
    },
    subtasks: [
      {
        section_id: "pr1-generated-validator",
        order: 1,
        title: "Generated validator",
        summary: "Check generated validator behavior.",
        spec_section_md: "## Generated validator\n\n- Check generated validator behavior.",
        priority: "high",
        implementation_owner: "ccb_codex",
        dependencies: [],
        include: true
      }
    ]
  };
}

test("generated dev-task validator accepts canonical frontmatter", () => {
  const result = validateDevTask({
    frontmatter: {
      doc_type: "dev_task",
      task_id: "subtask-abcdef123456",
      title: "Implement generated validators",
      status: "reviewing",
      current_node: "dispatch",
      node_substate: "awaiting_codex_pickup",
      priority: "medium",
      requirement_id: "req-1",
      section_id: "pr1-generated-validators",
      order: 1,
      implementation_owner: "ccb_codex",
      dependencies: [],
      source_breakdown_draft: "docs/.ccb/drafts/breakdown/req-1.json",
      source_draft_hash: "a".repeat(64),
      created_at: "2026-05-22T12:00:00.000Z"
    },
    body: "# Implement generated validators\n\n- Create shared generated validators from schema YAML."
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("generated dev-task validator rejects owner drift and status drift", () => {
  const result = validateDevTask({
    frontmatter: {
      doc_type: "technical_design",
      task_id: "subtask-abcdef123456",
      title: "Bad subtask",
      status: "active",
      current_node: "review",
      node_substate: "",
      priority: "medium",
      requirement_id: "req-1",
      section_id: "pr1-bad-subtask",
      order: 1,
      implementation_owner: "auto",
      dependencies: [],
      source_breakdown_draft: "docs/.ccb/drafts/breakdown/req-1.json",
      source_draft_hash: "a".repeat(64),
      created_at: "2026-05-22T12:00:00.000Z"
    },
    body: "# Bad subtask\n\n- This body is long enough to isolate frontmatter errors."
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.path === "status"), true);
  assert.equal(result.issues.some((issue) => issue.path === "doc_type"), true);
  assert.equal(result.issues.some((issue) => issue.path === "node_substate"), true);
  assert.equal(result.issues.some((issue) => issue.path === "implementation_owner"), true);
});

test("generated breakdown-draft validator rejects generation_source unknown keys", () => {
  const drifted = validBreakdownDraft();
  (drifted.generation_source as Record<string, unknown>).note = "dead field";

  const result = validateBreakdownDraft(drifted);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.path === "generation_source.note"), true);
});

test("generated breakdown-draft validator accepts missing review_history and review notes", () => {
  assert.equal(validateBreakdownDraft(validBreakdownDraft()).ok, true);

  const notedHistory = {
    ...validBreakdownDraft(),
    review_history: [
      {
        at: "2026-05-22T12:00:00.000Z",
        actor: "ai",
        action: "created",
        note: "legal review note"
      }
    ]
  };
  assert.equal(validateBreakdownDraft(notedHistory).ok, true);
});

test("console breakdown-draft schema rejects generation_source unknown keys", () => {
  const drifted = validBreakdownDraft();
  (drifted.generation_source as Record<string, unknown>).note = "dead field";

  const parsed = breakdownDraftSchema.safeParse(drifted);

  if (parsed.success) {
    assert.fail("expected breakdownDraftSchema to reject generation_source.note");
  }
  assert.equal(
    parsed.error.issues.some(
      (issue) =>
        issue.path.join(".") === "generation_source.note" ||
        (issue.path.join(".") === "generation_source" &&
          "keys" in issue &&
          Array.isArray(issue.keys) &&
          issue.keys.includes("note"))
    ),
    true
  );
});
