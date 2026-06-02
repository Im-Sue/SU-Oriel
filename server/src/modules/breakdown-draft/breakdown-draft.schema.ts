import { z } from "zod";

import { validateBreakdownDraft } from "../../generated/breakdown-draft-validator.js";

export const BREAKDOWN_DRAFT_SCHEMA_VERSION = "breakdown-draft-v0.2" as const;

// Deprecated compatibility layer: generated validator is the schema source.
// Keep zod route parsing here for Phase 4b; remove duplicate hand-written checks in v1.x.
export const breakdownDraftStatusSchema = z.enum([
  "draft",
  "reviewing",
  "approved",
  "consumed",
  "cancelled"
]);

export const breakdownDraftReviewEntrySchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    actor: z.enum(["ai", "user"]),
    action: z.enum(["created", "edited", "status_changed", "rejected"]),
    note: z.string().trim().min(1).max(4000).optional()
  })
  .strict();

export const breakdownDraftSubtaskSchema = z
  .object({
    section_id: z.string().trim().min(1),
    order: z.number().int().positive(),
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    spec_section_md: z.string().trim().min(1),
    priority: z.enum(["high", "medium", "low"]),
    implementation_owner: z.enum(["claude", "ccb_codex"]),
    dependencies: z.array(z.string().trim().min(1)),
    include: z.boolean()
  })
  .strict();

export const breakdownDraftSchema = z
  .object({
    schema_version: z.literal(BREAKDOWN_DRAFT_SCHEMA_VERSION),
    status: breakdownDraftStatusSchema,
    project_id: z.string().trim().min(1).optional(),
    requirement_id: z.string().trim().min(1),
    carrier_task_id: z.string().trim().min(1),
    carrier_task_key: z.string().trim().min(1),
    base_task_revision: z.number().int().nonnegative().nullable(),
    generated_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    generated_by: z.enum(["ai_session", "manual"]),
    generation_source: z
      .object({
        cc_agent: z.string().trim().min(1).optional(),
        cx_agent: z.string().trim().min(1).optional(),
        ccb_job_id: z.string().trim().min(1).optional(),
        manual_actor: z.string().trim().min(1).optional()
      })
      .strict(),
    plan: z
      .object({
        title: z.string().trim().min(1),
        summary: z.string().trim().min(1),
        spec_outline_md: z.string().trim().min(1),
        estimated_total_days: z.number().positive().nullable().optional()
      })
      .strict(),
    subtasks: z.array(breakdownDraftSubtaskSchema).min(1),
    review_history: z.array(breakdownDraftReviewEntrySchema).optional(),
    approved_at: z.string().datetime({ offset: true }).optional(),
    approved_by: z.string().trim().min(1).optional(),
    consumed_at: z.string().datetime({ offset: true }).optional(),
    consumed_by: z.string().trim().min(1).optional(),
    consumed_from_hash: z.string().regex(/^[a-f0-9]{64}$/).optional()
  })
  .strict()
  .superRefine((draft, ctx) => {
    const generated = validateBreakdownDraft(draft);
    for (const issue of generated.issues.filter(
      (entry) => !(entry.path === "base_task_revision" && entry.actual === null && entry.expected === "required")
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path.split("."),
        message: `generated schema: expected ${issue.expected}, got ${JSON.stringify(issue.actual)}`
      });
    }

    const sectionIds = new Set<string>();
    for (const [index, subtask] of draft.subtasks.entries()) {
      if (sectionIds.has(subtask.section_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["subtasks", index, "section_id"],
          message: `duplicate section_id '${subtask.section_id}'`
        });
      }
      sectionIds.add(subtask.section_id);
    }

    for (const [subtaskIndex, subtask] of draft.subtasks.entries()) {
      for (const [dependencyIndex, dependency] of subtask.dependencies.entries()) {
        if (!sectionIds.has(dependency)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["subtasks", subtaskIndex, "dependencies", dependencyIndex],
            message: `unknown dependency '${dependency}'`
          });
        }
      }
    }

    if (draft.status === "approved") {
      if (!draft.approved_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["approved_at"],
          message: "approved draft must include approved_at"
        });
      }
      if (!draft.approved_by) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["approved_by"],
          message: "approved draft must include approved_by"
        });
      }
    }
    if (draft.status === "consumed") {
      if (!draft.consumed_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["consumed_at"],
          message: "consumed draft must include consumed_at"
        });
      }
      if (!draft.consumed_by) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["consumed_by"],
          message: "consumed draft must include consumed_by"
        });
      }
      if (!draft.consumed_from_hash) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["consumed_from_hash"],
          message: "consumed draft must include consumed_from_hash"
        });
      }
    }
  });

export type BreakdownDraftStatus = z.infer<typeof breakdownDraftStatusSchema>;
export type BreakdownDraftReviewEntry = z.infer<typeof breakdownDraftReviewEntrySchema>;
export type BreakdownDraft = z.infer<typeof breakdownDraftSchema>;
