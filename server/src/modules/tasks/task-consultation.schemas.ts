import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);
const optionalMetricSchema = z.number().finite().nonnegative().optional();

export const taskConsultationParamsSchema = z
  .object({
    taskId: nonEmptyStringSchema
  })
  .strict();

export const taskConsultationEventSchema = z
  .object({
    event_id: nonEmptyStringSchema,
    sender: z.enum(["claude", "codex"]),
    receiver: z.enum(["claude", "codex"]),
    intent: nonEmptyStringSchema,
    intent_score: optionalMetricSchema,
    tokens_in: z.number().int().nonnegative().optional(),
    tokens_out: z.number().int().nonnegative().optional(),
    at: z.string().datetime(),
    payload_preview: z.string().max(500).optional()
  })
  .strict();

export const taskConsultationRoundSchema = z
  .object({
    round_number: z.number().int().positive(),
    node_id: nonEmptyStringSchema,
    events: z.array(taskConsultationEventSchema)
  })
  .strict();

export const taskConsultationResponseSchema = z
  .object({
    rounds: z.array(taskConsultationRoundSchema)
  })
  .strict();

export type TaskConsultationParams = z.infer<typeof taskConsultationParamsSchema>;
export type TaskConsultationEvent = z.infer<typeof taskConsultationEventSchema>;
export type TaskConsultationRound = z.infer<typeof taskConsultationRoundSchema>;
export type TaskConsultationResponse = z.infer<typeof taskConsultationResponseSchema>;
