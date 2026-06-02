import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);

export const taskNodeFlowParamsSchema = z
  .object({
    taskId: nonEmptyStringSchema
  })
  .strict();

export const taskNodeFlowTransitionVerdictSchema = z.enum(["pass", "wait", "fail"]);
export const taskNodeFlowGuardStatusSchema = z.enum(["satisfied", "blocked"]);
export const taskNodeFlowApplicabilitySchema = z.enum(["user_actionable", "system_only"]);

export const taskNodeFlowTransitionSchema = z
  .object({
    transition_id: nonEmptyStringSchema,
    source_node: nonEmptyStringSchema,
    target_node: nonEmptyStringSchema,
    verdict: taskNodeFlowTransitionVerdictSchema,
    at: z.string().datetime(),
    evidence_ref: nonEmptyStringSchema.optional()
  })
  .strict();

export const taskNodeFlowApplicableActionSchema = z
  .object({
    transition_id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    guard_status: taskNodeFlowGuardStatusSchema,
    applicability: taskNodeFlowApplicabilitySchema,
    guard_reason: nonEmptyStringSchema.optional()
  })
  .strict();

export const taskNodeFlowResponseSchema = z
  .object({
    currentNode: nonEmptyStringSchema,
    nodeSubstate: nonEmptyStringSchema,
    runtimeState: nonEmptyStringSchema,
    lastTransitionId: z.string().nullable(),
    lastTransitionAt: z.string().datetime().nullable(),
    transitions: z.array(taskNodeFlowTransitionSchema),
    applicable_actions: z.array(taskNodeFlowApplicableActionSchema)
  })
  .strict();

export type TaskNodeFlowParams = z.infer<typeof taskNodeFlowParamsSchema>;
export type TaskNodeFlowTransition = z.infer<typeof taskNodeFlowTransitionSchema>;
export type TaskNodeFlowApplicableAction = z.infer<typeof taskNodeFlowApplicableActionSchema>;
export type TaskNodeFlowResponse = z.infer<typeof taskNodeFlowResponseSchema>;
