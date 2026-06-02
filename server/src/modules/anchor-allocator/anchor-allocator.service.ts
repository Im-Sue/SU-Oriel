import { join } from "node:path";

import { Prisma, type AnchorAllocation, type PrismaClient } from "@prisma/client";

const MAX_ACTIVE_ANCHORS = 10;

const ACTIVE_ANCHOR_STATES = [
  "planned",
  "worktree_creating",
  "configuring",
  "mounting",
  "ready",
  "busy",
  "mount_failed",
  "recovering",
  "orphaned",
  "cleanup_required"
] as const;

let acquireLock: Promise<void> = Promise.resolve();

export type AcquireAnchorInput = {
  projectId: string;
  subjectType: "requirement" | "subtask";
  subjectId: string;
  subjectKey?: string | null;
  mode?: "planning" | "execution";
  anchorPath: string;
};

export class AnchorAllocatorService {
  constructor(private readonly client: PrismaClient) {}

  async acquireAnchor(input: AcquireAnchorInput): Promise<AnchorAllocation | null> {
    return await withAcquireLock(async () => {
      const existing = await this.client.anchorAllocation.findFirst({
        where: {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          mode: input.mode ?? "execution",
          state: {
            in: [...ACTIVE_ANCHOR_STATES]
          }
        }
      });
      if (existing) {
        return null;
      }

      const activeCount = await this.client.anchorAllocation.count({
        where: {
          state: {
            in: [...ACTIVE_ANCHOR_STATES]
          }
        }
      });
      if (activeCount >= MAX_ACTIVE_ANCHORS) {
        return null;
      }

      try {
        return await this.client.anchorAllocation.create({
          data: {
            anchorId: buildAnchorId(input.subjectType, input.subjectId, input.mode ?? "execution"),
            anchorPath: input.anchorPath,
            projectId: input.projectId,
            socketPath: buildAnchorSocketPath(input.anchorPath),
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            subjectKey: input.subjectKey ?? null,
            mode: input.mode ?? "execution",
            state: "planned"
          }
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return null;
        }
        throw error;
      }
    });
  }

  async rollbackAnchor(anchorId: string): Promise<void> {
    await this.client.anchorAllocation.deleteMany({
      where: {
        anchorId
      }
    });
  }

  async markState(anchorId: string, state: AnchorAllocation["state"]): Promise<AnchorAllocation> {
    return await this.client.anchorAllocation.update({
      where: {
        anchorId
      },
      data: {
        state,
        heartbeatAt: new Date()
      }
    });
  }

  async markReady(anchorId: string, socketPath?: string): Promise<AnchorAllocation> {
    return await this.client.anchorAllocation.update({
      where: {
        anchorId
      },
      data: {
        state: "ready",
        runtimePaused: false,
        ...(socketPath ? { socketPath } : {}),
        startedAt: new Date(),
        heartbeatAt: new Date()
      }
    });
  }

  async markRuntimePaused(
    anchorId: string,
    paused: boolean,
    socketPath?: string | null
  ): Promise<AnchorAllocation> {
    return await this.client.anchorAllocation.update({
      where: {
        anchorId
      },
      data: {
        runtimePaused: paused,
        ...(paused ? { socketPath: null } : socketPath !== undefined ? { socketPath } : {})
      }
    });
  }

  async listAnchors(): Promise<AnchorAllocation[]> {
    return await this.client.anchorAllocation.findMany({
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  async archiveAnchor(anchorId: string): Promise<AnchorAllocation> {
    return await this.markState(anchorId, "archiving");
  }
}

export function buildAnchorSocketPath(anchorPath: string): string {
  return join(anchorPath, ".ccb", "ccbd", "ccbd.sock");
}

export function buildAnchorId(subjectType: string, subjectId: string, mode = "execution"): string {
  const slug = `${subjectType}-${mode}-${subjectId}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `anchor_${slug || "subject"}`;
}

async function withAcquireLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = acquireLock;
  let release!: () => void;
  acquireLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
