import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db/prisma.js";

const transitionSchema = z
  .object({
    from_node: z.string().nullable(),
    to_node: z.string().min(1),
    transition_id: z.string().min(1),
    triggered_at: z.string().min(1)
  })
  .passthrough();

const capabilityDecisionSchema = z
  .object({
    capability_requested: z.string().min(1),
    resolved_binding: z.string().nullable(),
    decision_at: z.string().min(1)
  })
  .passthrough();

const nodeRunResponseItemSchema = z
  .object({
    version: z.literal("noderun-v0.1"),
    node_id: z.string().min(1),
    entered_at: z.string().min(1),
    exited_at: z.string().nullable(),
    transitions: z.array(transitionSchema),
    capability_decisions: z.array(capabilityDecisionSchema),
    mutation_sources: z.array(z.record(z.unknown())).optional()
  })
  .passthrough();

function parseJsonArray(value: string | null): unknown[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeNodeRun(run: {
  version: string;
  nodeId: string;
  enteredAt: Date;
  exitedAt: Date | null;
  transitionsJson: string;
  capabilityDecisionsJson: string;
  mutationSourcesJson: string | null;
}) {
  const mutationSources = parseJsonArray(run.mutationSourcesJson);
  return nodeRunResponseItemSchema.parse({
    version: run.version,
    node_id: run.nodeId,
    entered_at: run.enteredAt.toISOString(),
    exited_at: run.exitedAt?.toISOString() ?? null,
    transitions: parseJsonArray(run.transitionsJson),
    capability_decisions: parseJsonArray(run.capabilityDecisionsJson),
    ...(mutationSources.length > 0 ? { mutation_sources: mutationSources } : {})
  });
}

export async function registerNodeRunRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { taskId: string } }>("/api/noderuns/:taskId", async (request) => {
    const runs = await prisma.nodeRun.findMany({
      where: {
        taskId: request.params.taskId
      },
      orderBy: {
        enteredAt: "asc"
      }
    });

    return runs.map(serializeNodeRun);
  });
}
