import type { AnchorAllocation, PrismaClient, Requirement } from "@prisma/client";

import {
  AgentNotFoundError,
  AnchorSocketNotReadyError,
  CcbdUnavailableError,
  ProtocolError,
  QueueRejectedError
} from "../ccbd-client/ccbd-client.errors.js";
import { CcbdClientService } from "../ccbd-client/ccbd-client.service.js";
import type { CcbdClientServiceLike } from "../ccbd-client/ccbd-client.types.js";
import { MultiAnchorBrokerService } from "../anchor-broker/broker.service.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";

const REANALYZE_REQUIREMENT_STATUSES = new Set(["drafting", "planning", "delivering", "deferred"]);
const ACTIVE_REANALYZE_ANCHOR_STATES: AnchorAllocation["state"][] = ["ready", "busy"];

export type RequirementReanalyzeJobStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface RequirementReanalyzeDispatcher {
  submit(input: {
    anchorId: string;
    anchorTaskId: string;
    requirementId: string;
    projectRoot: string;
  }): Promise<{ jobId: string }>;
  getStatus(input: { anchorId: string; jobId: string }): Promise<{ status: RequirementReanalyzeJobStatus; error?: string }>;
}

export interface RequirementReanalyzeDispatchResult {
  mode: "async";
  requirementId: string;
  anchorTaskId: string;
  anchorId: string;
  jobId: string;
  status: "pending";
}

export class RequirementReanalyzeNotFoundError extends Error {
  constructor(message = "需求不存在") {
    super(message);
  }
}

export class RequirementReanalyzeStatusConflictError extends Error {
  public readonly code = "status_locked";

  constructor(status: string) {
    super(`当前状态不允许重新解析: ${status}`);
  }
}

export class RequirementReanalyzeNoAnchorError extends Error {
  public readonly code = "no_anchor";

  constructor(message = "需要先立项后才能重新解析") {
    super(message);
  }
}

export class RequirementAnchorUnavailableError extends Error {
  public readonly code = "anchor_unavailable";
  public readonly retryAfter = "manual-retry";

  constructor(message = "anchor 不可达，请稍后重试") {
    super(message);
  }
}

export class RequirementAiUnavailableError extends Error {
  public readonly retryAfter = "manual-retry";

  constructor(message = "AI service unavailable") {
    super(message);
  }
}

function normalizeJobStatus(rawStatus: unknown, raw: Record<string, unknown>): { status: RequirementReanalyzeJobStatus; error?: string } {
  const normalized = String(rawStatus ?? raw.state ?? "").trim().toLowerCase();
  const rawError = typeof raw.error === "string"
    ? raw.error
    : typeof raw.message === "string"
      ? raw.message
      : undefined;

  if (normalized === "queued" || normalized === "pending" || normalized === "submitted") {
    return { status: "pending" };
  }
  if (normalized === "running" || normalized === "started" || normalized === "in_progress") {
    return { status: "running" };
  }
  if (normalized === "completed" || normalized === "succeeded" || normalized === "success") {
    return { status: "completed" };
  }
  if (normalized === "timeout" || normalized === "timed_out") {
    return { status: "timeout", ...(rawError ? { error: rawError } : {}) };
  }
  if (normalized === "failed" || normalized === "error" || normalized === "cancelled") {
    return { status: "failed", ...(rawError ? { error: rawError } : {}) };
  }

  return { status: "pending" };
}

function mapAnchorError(error: unknown): RequirementAnchorUnavailableError {
  if (error instanceof RequirementAnchorUnavailableError) {
    return error;
  }
  if (
    error instanceof CcbdUnavailableError ||
    error instanceof AgentNotFoundError ||
    error instanceof QueueRejectedError ||
    error instanceof AnchorSocketNotReadyError ||
    error instanceof ProtocolError
  ) {
    return new RequirementAnchorUnavailableError();
  }
  if (error instanceof Error) {
    return new RequirementAnchorUnavailableError(error.message);
  }
  return new RequirementAnchorUnavailableError();
}

function buildAnchorSkillPrompt(input: {
  requirementId: string;
  projectRoot: string;
}): string {
  return [
    "请使用 `requirement-reanalyze` skill 执行需求重新解析。",
    "",
    "args JSON:",
    JSON.stringify({
      requirement_id: input.requirementId,
      project_root: input.projectRoot
    }),
    "",
    "要求：在 anchor 内生成真实 LLM 解析，直接写 requirement markdown，并在 frontmatter 写入 analysis_input_hash / analysis_applied_at。完成后回 [CCB_TASK_COMPLETED]。"
  ].join("\n");
}

export class CcbdRequirementReanalyzeDispatcher implements RequirementReanalyzeDispatcher {
  constructor(private readonly client: Pick<CcbdClientServiceLike, "submit" | "get">) {}

  async submit(input: {
    anchorId: string;
    anchorTaskId: string;
    requirementId: string;
    projectRoot: string;
  }): Promise<{ jobId: string }> {
    try {
      const result = await this.client.submit({
        anchorId: input.anchorId,
        toAgent: "ccb_claude",
        taskId: input.anchorTaskId,
        body: buildAnchorSkillPrompt(input),
        fromActor: "system",
        messageType: "ask"
      });
      return { jobId: result.jobId };
    } catch (error) {
      throw mapAnchorError(error);
    }
  }

  async getStatus(input: { anchorId: string; jobId: string }): Promise<{ status: RequirementReanalyzeJobStatus; error?: string }> {
    try {
      const raw = await this.client.get(input.jobId, { anchorId: input.anchorId });
      return normalizeJobStatus(raw.status ?? raw.job_status, raw);
    } catch (error) {
      throw mapAnchorError(error);
    }
  }
}

export function createRequirementReanalyzeDispatcher(prisma: PrismaClient): RequirementReanalyzeDispatcher {
  // Deprecated ADR-0032 legacy path: no frontend entry calls this dispatcher after E4.
  // Re-enabling reanalyze should route through SlotBinding/JobSlotRouter instead of AnchorAllocation + ccb_claude.
  const broker = new MultiAnchorBrokerService(prisma);
  const client = new CcbdClientService({
    anchorSocketResolver: async (anchorId) => await broker.resolveAnchor(anchorId)
  });
  return new CcbdRequirementReanalyzeDispatcher(client);
}

export async function resolveAnchorTaskId(
  prisma: PrismaClient,
  requirement: Pick<Requirement, "id">
): Promise<string> {
  void prisma;
  return requirement.id;
}

async function resolveAnchorAllocation(prisma: PrismaClient, requirementId: string): Promise<AnchorAllocation> {
  const anchor = await prisma.anchorAllocation.findFirst({
    where: {
      subjectType: "requirement",
      subjectId: requirementId,
      mode: "planning",
      socketPath: {
        not: null
      },
      state: {
        in: ACTIVE_REANALYZE_ANCHOR_STATES
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (!anchor) {
    throw new RequirementAnchorUnavailableError();
  }
  return anchor;
}

export async function reanalyzeRequirement(
  prisma: PrismaClient,
  projectId: string,
  requirementId: string,
  dispatcher: RequirementReanalyzeDispatcher = createRequirementReanalyzeDispatcher(prisma)
): Promise<RequirementReanalyzeDispatchResult> {
  return await primitiveExecutor.run({
    primitive: "requirement.reanalyze",
    mutationType: "ccb.ask submit",
    run: async () => {
      const requirement = await prisma.requirement.findFirst({
        where: {
          id: requirementId,
          projectId
        },
        include: {
          project: true
        }
      });

      if (!requirement) {
        throw new RequirementReanalyzeNotFoundError();
      }
      if (!REANALYZE_REQUIREMENT_STATUSES.has(requirement.status)) {
        throw new RequirementReanalyzeStatusConflictError(requirement.status);
      }

      const anchorTaskId = await resolveAnchorTaskId(prisma, requirement);
      const anchor = await resolveAnchorAllocation(prisma, anchorTaskId);
      const submitted = await dispatcher.submit({
        anchorId: anchor.anchorId,
        anchorTaskId,
        requirementId,
        projectRoot: requirement.project.localPath
      });

      return {
        mode: "async",
        requirementId,
        anchorTaskId,
        anchorId: anchor.anchorId,
        jobId: submitted.jobId,
        status: "pending"
      };
    }
  });
}

export async function getRequirementReanalyzeJobStatus(
  prisma: PrismaClient,
  projectId: string,
  requirementId: string,
  jobId: string,
  dispatcher: RequirementReanalyzeDispatcher = createRequirementReanalyzeDispatcher(prisma)
): Promise<{ status: RequirementReanalyzeJobStatus; error?: string }> {
  const requirement = await prisma.requirement.findFirst({
    where: {
      id: requirementId,
      projectId
    }
  });
  if (!requirement) {
    throw new RequirementReanalyzeNotFoundError();
  }

  const anchorTaskId = await resolveAnchorTaskId(prisma, requirement);
  const anchor = await resolveAnchorAllocation(prisma, anchorTaskId);
  return await dispatcher.getStatus({
    anchorId: anchor.anchorId,
    jobId
  });
}
