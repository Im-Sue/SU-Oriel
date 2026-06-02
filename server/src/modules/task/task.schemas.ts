import { z } from "zod";

// phase is now derived from currentNode/nodeSubstate; v0.4 will remove the column.
export const updateTaskSchema = z
  .object({
    priority: z.enum(["low", "medium", "high", "urgent"]).optional()
  })
  .strict();

export const createReviewIntentSchema = z
  .object({
    intentType: z.enum(["mark_review_pass", "request_replan", "request_escalate"]),
    payload: z.string().trim().max(1000).optional()
  })
  .strict();

export const listReviewIntentQuerySchema = z
  .object({
    status: z.enum(["pending", "consumed", "cancelled"]).optional()
  })
  .strict();

export const consumeReviewIntentSchema = z
  .discriminatedUnion("result", [
    z
      .object({
        consumer: z.literal("su-review"),
        result: z.literal("considered")
      })
      .strict(),
    z
      .object({
        consumer: z.literal("su-review"),
        result: z.literal("failed"),
        failureReason: z.enum(["parse", "interpretation", "consumer_error"]),
        error: z.string().trim().min(1).max(1000)
      })
      .strict()
  ]);
