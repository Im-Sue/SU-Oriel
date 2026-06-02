import { z } from "zod";

export const roleProfilePayloadSchema = z
  .object({
    version: z.literal("role-profile-v0.1"),
    name: z.string().min(1),
    executor_profile_id: z.string().min(1),
    prompt_template_ref: z.string().regex(/^docs\/\.ccb\/templates\/prompts\/[^/]+\.md$/),
    variable_overrides: z.record(z.unknown())
  })
  .strict();

export type RoleProfilePayload = z.infer<typeof roleProfilePayloadSchema>;
