import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PrismaClient, SlotBinding } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { emitEventInTransaction } from "../events/event-journal.service.js";
import { notifySlotStaleDetectorHook } from "../hooks/hooks.service.js";

export type SlotStalePolicy = {
  staleThresholdDays: number;
  busyTimeoutHours: number;
  notificationChannel: "hook";
};

export type SlotStaleDetectorResult = {
  staleMarked: number;
  busyTimedOut: number;
};

export type SlotStaleNotification = {
  projectId: string;
  slotId: string;
  requirementId: string | null;
  kind: "stale" | "busy_timeout";
  detectedAt: Date;
};

export interface SlotStaleDetectorLogger {
  warn?: (payload: unknown, message?: string) => void;
  error?: (payload: unknown, message?: string) => void;
}

export const SLOT_STALE_POLICY_RELATIVE_PATH = join("docs", ".ccb", "config", "slot-stale-policy.yaml");
const DEFAULT_POLICY_TEXT = [
  "stale_threshold_days: 7",
  "busy_timeout_hours: 4",
  "notification_channel: hook",
  ""
].join("\n");

export class SlotStaleDetector {
  constructor(private readonly options: {
    prismaClient?: PrismaClient;
    now?: () => Date;
    notify?: (notification: SlotStaleNotification) => Promise<void>;
    logger?: SlotStaleDetectorLogger;
  } = {}) {}

  async runOnce(projectId?: string): Promise<SlotStaleDetectorResult> {
    const client = this.options.prismaClient ?? prisma;
    const now = this.options.now?.() ?? new Date();
    const projects = await client.project.findMany({
      where: projectId ? { id: projectId } : {},
      select: { id: true, localPath: true }
    });

    let staleMarked = 0;
    let busyTimedOut = 0;
    for (const project of projects) {
      const policy = await ensureSlotStalePolicy(project.localPath);
      const staleCutoff = new Date(now.getTime() - policy.staleThresholdDays * 24 * 60 * 60 * 1000);
      const busyCutoff = new Date(now.getTime() - policy.busyTimeoutHours * 60 * 60 * 1000);

      const staleRows = await client.slotBinding.findMany({
        where: {
          projectId: project.id,
          state: "bound",
          requirementId: { not: null },
          staleDetectedAt: null,
          OR: [
            { lastActivityAt: null },
            { lastActivityAt: { lt: staleCutoff } }
          ]
        }
      });
      for (const row of staleRows) {
        await client.slotBinding.update({
          where: { id: row.id },
          data: {
            staleDetectedAt: now,
            staleNotifiedCount: { increment: 1 }
          }
        });
        await this.notify({
          projectId: project.id,
          slotId: row.slotId,
          requirementId: row.requirementId,
          kind: "stale",
          detectedAt: now
        });
        staleMarked++;
      }

      const busyRows = await client.slotBinding.findMany({
        where: {
          projectId: project.id,
          state: "busy",
          requirementId: { not: null },
          OR: [
            { busySince: { lt: busyCutoff } },
            {
              busySince: null,
              lastActivityAt: { lt: busyCutoff }
            }
          ]
        }
      });
      for (const row of busyRows) {
        await this.markBusyTimeout(client, row, now);
        await this.notify({
          projectId: project.id,
          slotId: row.slotId,
          requirementId: row.requirementId,
          kind: "busy_timeout",
          detectedAt: now
        });
        busyTimedOut++;
      }
    }

    return { staleMarked, busyTimedOut };
  }

  private async markBusyTimeout(client: PrismaClient, row: SlotBinding, now: Date): Promise<void> {
    if (!row.requirementId) return;
    const requirementId = row.requirementId;
    await client.$transaction(async (tx) => {
      await tx.slotBinding.update({
        where: { id: row.id },
        data: {
          state: "unhealthy",
          staleDetectedAt: now,
          staleNotifiedCount: { increment: 1 }
        }
      });
      await emitEventInTransaction(tx, {
        event_id: randomUUID(),
        event_type: "slot_runtime_degraded",
        subject_type: "requirement",
        subject_id: requirementId,
        anchor_id: row.slotId,
        emitted_at: now.toISOString(),
        source_actor: "system",
        source_component: "console",
        idempotency_key: `slot-runtime-degraded:${row.projectId}:${row.slotId}:${now.getTime()}`,
        payload: {
          slotId: row.slotId,
          reason: "busy_timeout",
          severity: "error"
        }
      });
    });
  }

  private async notify(notification: SlotStaleNotification): Promise<void> {
    try {
      const notifier =
        this.options.notify ??
        (async (payload: SlotStaleNotification) => {
          await notifySlotStaleDetectorHook(this.options.prismaClient ?? prisma, payload);
        });
      await notifier(notification);
    } catch (error) {
      this.options.logger?.warn?.(
        { event: "slot-stale-detector.notify.failed", notification, err: error },
        "slot stale notification failed; state update kept"
      );
    }
  }
}

export async function ensureSlotStalePolicy(projectRoot: string): Promise<SlotStalePolicy> {
  const policyPath = join(projectRoot, SLOT_STALE_POLICY_RELATIVE_PATH);
  let text = await readFile(policyPath, "utf8").catch(() => null);
  if (!text) {
    await mkdir(join(projectRoot, "docs", ".ccb", "config"), { recursive: true });
    await writeFile(policyPath, DEFAULT_POLICY_TEXT, "utf8");
    text = DEFAULT_POLICY_TEXT;
  }
  return parsePolicy(text);
}

function parsePolicy(text: string): SlotStalePolicy {
  const values = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    if (match?.[1] && match[2]) {
      values.set(match[1], match[2].trim());
    }
  }
  return {
    staleThresholdDays: positiveNumber(values.get("stale_threshold_days"), 7),
    busyTimeoutHours: positiveNumber(values.get("busy_timeout_hours"), 4),
    notificationChannel: "hook"
  };
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
