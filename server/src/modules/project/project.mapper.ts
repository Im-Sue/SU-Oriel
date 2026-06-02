import type { Project } from "@prisma/client";

import type { ProjectRecord } from "./project.types.js";

export function mapProjectRecord(input: Project): ProjectRecord {
  return {
    id: input.id,
    name: input.name,
    localPath: input.localPath,
    summary: input.summary,
    initStatus: input.initStatus as ProjectRecord["initStatus"],
    docsRoot: input.docsRoot,
    lastScanAt: input.lastScanAt ? input.lastScanAt.toISOString() : null,
    syncStatus: input.syncStatus as ProjectRecord["syncStatus"],
    ownerUserId: input.ownerUserId,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString()
  };
}
