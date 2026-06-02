import { z } from "zod";

export const transitionProposalParamsSchema = z
  .object({
    eventId: z.string().trim().uuid()
  })
  .strict();

export const transitionProposalQuerySchema = z
  .object({
    task_id: z.string().trim().min(1).optional()
  })
  .strict();

export type TransitionProposalParams = z.infer<typeof transitionProposalParamsSchema>;
export type TransitionProposalQuery = z.infer<typeof transitionProposalQuerySchema>;
