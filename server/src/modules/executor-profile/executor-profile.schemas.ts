import { z } from "zod";

const capabilityBindingSchema = z
  .object({
    capability_id: z.string().min(1)
  })
  .strict();

export const executorProfilePayloadSchema = z
  .object({
    version: z.literal("executor-profile-v0.1"),
    provider: z.string().min(1),
    model: z.string().min(1),
    runtime: z.enum(["external", "pty", "command", "settings"]),
    permission: z.enum(["read", "write", "admin"]),
    capability_binding: capabilityBindingSchema,
    last_updated: z.string().datetime(),
    meta: z.record(z.unknown()).optional()
  })
  .strict();

export type ExecutorProfilePayload = z.infer<typeof executorProfilePayloadSchema>;
