import type { PrismaClient } from "@prisma/client";

import { primitiveExecutor } from "../primitive/primitive-wrapper.js";
import type { HookDemoResponse, PreTaskCreateHookPayload } from "./hooks.schemas.js";
import { hookDemoResponseSchema } from "./hooks.schemas.js";

const PRE_TASK_CREATE_HOOK = "pre-task-create";
const SLOT_STALE_DETECTOR_HOOK = "slot-stale-detector";

export interface SlotStaleDetectorHookNotification {
  projectId: string;
  slotId: string;
  requirementId: string | null;
  kind: "stale" | "busy_timeout";
  detectedAt: Date;
}

function buildDemoOutcome() {
  return {
    ok: true,
    mode: "demo",
    state_mutation: false,
    kernel_command: false
  } as const;
}

export async function triggerPreTaskCreateHook(
  prisma: PrismaClient,
  payload: PreTaskCreateHookPayload
): Promise<HookDemoResponse> {
  const outcome = buildDemoOutcome();
  const auditLog = await primitiveExecutor.run({
    primitive: "record_hook_audit_log",
    mutationType: "prisma.hookAuditLog.create",
    idempotencyKey: `${PRE_TASK_CREATE_HOOK}:${Date.now()}`,
    run: async () =>
      await prisma.hookAuditLog.create({
        data: {
          hookName: PRE_TASK_CREATE_HOOK,
          payloadSnapshotJson: JSON.stringify(payload),
          outcomeJson: JSON.stringify(outcome)
        }
      })
  });

  return hookDemoResponseSchema.parse({
    ...outcome,
    hook_name: auditLog.hookName,
    audit_log_id: auditLog.id,
    triggered_at: auditLog.triggeredAt.toISOString()
  });
}

export async function notifySlotStaleDetectorHook(
  prisma: PrismaClient,
  notification: SlotStaleDetectorHookNotification
): Promise<void> {
  const payload = {
    project_id: notification.projectId,
    slot_id: notification.slotId,
    requirement_id: notification.requirementId,
    kind: notification.kind,
    detected_at: notification.detectedAt.toISOString()
  };
  const outcome = {
    ok: true,
    mode: "notify",
    state_mutation: false,
    kernel_command: false
  } as const;

  await primitiveExecutor.run({
    primitive: "record_hook_audit_log",
    mutationType: "prisma.hookAuditLog.create",
    idempotencyKey: [
      SLOT_STALE_DETECTOR_HOOK,
      notification.projectId,
      notification.slotId,
      notification.kind,
      notification.detectedAt.toISOString()
    ].join(":"),
    run: async () => {
      await prisma.hookAuditLog.create({
        data: {
          hookName: SLOT_STALE_DETECTOR_HOOK,
          triggeredAt: notification.detectedAt,
          payloadSnapshotJson: JSON.stringify(payload),
          outcomeJson: JSON.stringify(outcome)
        }
      });
    }
  });
}
