import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { ensureManagedCcbConfig } from "../project-ccbd/managed-config.service.js";

const ACTIVE_TIP_STATES = ["bound", "busy", "unhealthy", "recovering"] as const;
export const SLOT_TIP_TITLE_MAX_CHARS = 24;

type SlotTipsProjectionClient = Pick<PrismaClient, "project" | "slotBinding">;

type SlotTipsLogger = {
  warn?: (input: Record<string, unknown>, message: string) => void;
};

export type SlotTipsSyncResult = {
  projectId: string;
  projectRoot: string | null;
  tips: string[];
  status: "ok" | "skipped" | "failed";
  reason?: string;
};

const projectLocks = new Map<string, Promise<void>>();

export async function computeSlotTipsProjection(
  client: Pick<PrismaClient, "slotBinding">,
  projectId: string
): Promise<string[]> {
  const rows = await client.slotBinding.findMany({
    where: {
      projectId,
      requirementId: {
        not: null
      },
      state: {
        in: [...ACTIVE_TIP_STATES]
      }
    },
    include: {
      requirement: {
        select: {
          title: true
        }
      }
    }
  });

  return rows
    .filter((row) => row.requirement)
    .sort((left, right) => slotOrder(left.slotId) - slotOrder(right.slotId))
    .map((row) => `${row.slotId}: ${truncateTipTitle(row.requirement?.title ?? "")}`);
}

export async function syncSlotTips(
  projectId: string,
  options: {
    client?: SlotTipsProjectionClient;
    logger?: SlotTipsLogger;
  } = {}
): Promise<SlotTipsSyncResult> {
  const client = options.client ?? prisma;
  return await withProjectLock(projectId, async () => {
    try {
      const project = await client.project.findUnique({
        where: { id: projectId },
        select: { localPath: true }
      });
      if (!project) {
        return {
          projectId,
          projectRoot: null,
          tips: [],
          status: "skipped",
          reason: "project_missing"
        };
      }

      const tips = await computeSlotTipsProjection(client, projectId);
      await ensureManagedCcbConfig({
        projectId,
        projectRoot: project.localPath,
        sidebarViewTips: tips
      });
      return {
        projectId,
        projectRoot: project.localPath,
        tips,
        status: "ok"
      };
    } catch (error) {
      options.logger?.warn?.(
        {
          event: "slot_tips.sync.failed",
          projectId,
          err: error
        },
        "slot tips sync failed; continuing main slot flow"
      );
      return {
        projectId,
        projectRoot: null,
        tips: [],
        status: "failed",
        reason: errorMessage(error)
      };
    }
  });
}

function truncateTipTitle(title: string): string {
  const text = title.trim();
  const chars = [...text];
  if (chars.length <= SLOT_TIP_TITLE_MAX_CHARS) {
    return text;
  }
  return `${chars.slice(0, SLOT_TIP_TITLE_MAX_CHARS - 3).join("")}...`;
}

function slotOrder(slotId: string): number {
  const match = slotId.match(/^slot-(\d+)$/);
  return match?.[1] ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function withProjectLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  const previous = projectLocks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => current);
  projectLocks.set(projectId, next);

  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (projectLocks.get(projectId) === next) {
      projectLocks.delete(projectId);
    }
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message.slice(0, 200);
  }
  return String(error).slice(0, 200);
}
