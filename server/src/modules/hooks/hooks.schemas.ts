import { z } from "zod";

export const preTaskCreateHookPayloadSchema = z
  .object({
    project_id: z.string().min(1),
    task_key: z.string().min(1),
    title: z.string().min(1)
  })
  .passthrough();

export const hookDemoResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.literal("demo"),
  hook_name: z.literal("pre-task-create"),
  audit_log_id: z.string().min(1),
  triggered_at: z.string().min(1),
  state_mutation: z.literal(false),
  kernel_command: z.literal(false)
});

export type PreTaskCreateHookPayload = z.infer<typeof preTaskCreateHookPayloadSchema>;
export type HookDemoResponse = z.infer<typeof hookDemoResponseSchema>;
