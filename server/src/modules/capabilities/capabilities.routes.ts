import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  resolveCapabilityDualRun,
  writeResolverTrace,
  type CapabilityDefinition,
  type CapabilityOverrides,
  type OldHintDecision
} from "./resolver.js";

const bindingSchema = z.object({
  binding_id: z.string(),
  provider: z.string(),
  entrypoint: z.string(),
  mode: z.string().optional(),
  role: z.string().optional(),
  arguments_template: z.unknown().optional(),
  timeout_seconds: z.number().int().positive().optional()
});

const capabilityDefinitionSchema = z.object({
  capability_id: z.string(),
  criticality: z.string(),
  provider_bindings: z.object({
    candidates: z.array(bindingSchema)
  }),
  degradation: z
    .object({
      default_action: z.string(),
      allowed_fallbacks: z.array(z.string()).optional()
    })
    .optional()
});

const oldHintBindingSchema = z.object({
  binding_id: z.string().nullable(),
  source: z.string()
});

const resolveCapabilityBodySchema = z.object({
  task_id: z.string().min(1),
  capability_requested: z.string().min(1),
  global_capabilities: z.array(capabilityDefinitionSchema),
  project_overrides: z.record(z.unknown()).optional(),
  user_overrides: z.record(z.unknown()).optional(),
  manual_override: z.boolean().optional(),
  old_hint_binding: oldHintBindingSchema.optional()
});

export interface CapabilityRoutesOptions {
  traceDir?: string;
}

export async function registerCapabilityRoutes(
  app: FastifyInstance,
  options: CapabilityRoutesOptions = {}
): Promise<void> {
  app.post("/api/capabilities/resolve", async (request, reply) => {
    const parsed = resolveCapabilityBodySchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      reply.status(400);
      return {
        message: "capability resolver 参数不合法",
        issues: parsed.error.issues
      };
    }

    const body = parsed.data;
    const resolution = resolveCapabilityDualRun({
      capability_requested: body.capability_requested,
      globalCapabilities: body.global_capabilities as CapabilityDefinition[],
      projectOverrides: body.project_overrides as CapabilityOverrides | undefined,
      userOverrides: body.user_overrides as CapabilityOverrides | undefined,
      manual_override: body.manual_override,
      oldHintResolver: body.old_hint_binding
        ? () => body.old_hint_binding as OldHintDecision
        : undefined
    });
    const tracePath = await writeResolverTrace(resolution.trace, {
      taskId: body.task_id,
      traceDir: options.traceDir
    });

    return {
      capability_requested: resolution.capability_requested,
      status: resolution.status,
      selected_binding: resolution.selected_binding,
      old_hint_binding: resolution.old_hint_binding,
      decision_path: resolution.decision_path,
      trace: resolution.trace,
      trace_path: tracePath
    };
  });
}
