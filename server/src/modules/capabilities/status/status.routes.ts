import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../../db/prisma.js";

const capabilityStatusItemSchema = z
  .object({
    name: z.string().min(1),
    binding_source: z.enum(["project", "user", "global"]),
    status: z.enum(["active", "deprecated", "disabled"]),
    last_used_at: z.string().nullable()
  })
  .passthrough();

const capabilityStatusMatrixSchema = z
  .object({
    version: z.literal("cap-matrix-v0.1"),
    capabilities: z.array(capabilityStatusItemSchema)
  })
  .passthrough();

function serializeCapabilityStatus(status: {
  name: string;
  bindingSource: string;
  status: string;
  lastUsedAt: Date | null;
}) {
  return capabilityStatusItemSchema.parse({
    name: status.name,
    binding_source: status.bindingSource,
    status: status.status,
    last_used_at: status.lastUsedAt?.toISOString() ?? null
  });
}

export async function registerCapabilityStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/capabilities/status", async () => {
    const statuses = await prisma.capabilityStatus.findMany({
      orderBy: [
        {
          name: "asc"
        },
        {
          bindingSource: "asc"
        }
      ]
    });

    return capabilityStatusMatrixSchema.parse({
      version: "cap-matrix-v0.1",
      capabilities: statuses.map(serializeCapabilityStatus)
    });
  });
}
