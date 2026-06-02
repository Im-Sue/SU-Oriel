import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);

export const codexReceiptBridgeSchema = z
  .object({
    job_id: nonEmptyStringSchema,
    reply_id: nonEmptyStringSchema,
    task_id: nonEmptyStringSchema,
    project_id: nonEmptyStringSchema.optional(),
    spec_id: nonEmptyStringSchema.optional(),
    status: z.literal("completed").default("completed"),
    completed_at: z.string().datetime().optional(),
    provider: nonEmptyStringSchema.default("codex"),
    receipt_ref: nonEmptyStringSchema.optional(),
    receipt_summary: nonEmptyStringSchema.optional(),
    reply_text: nonEmptyStringSchema.optional(),
    unsolicited_findings: z.array(z.unknown()).default([])
  })
  .strict();

export type CodexReceiptBridgeInput = z.output<typeof codexReceiptBridgeSchema>;
