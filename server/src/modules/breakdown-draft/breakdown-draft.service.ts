import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";

import type { AskRouterService } from "../anchor-broker/ask-router.service.js";
import {
  breakdownDraftSchema,
  type BreakdownDraft,
  type BreakdownDraftReviewEntry,
  type BreakdownDraftStatus
} from "./breakdown-draft.schema.js";
import {
  BreakdownDraftConflictError,
  BreakdownDraftHashMismatchError,
  BreakdownDraftIoError,
  BreakdownDraftNotFoundError,
  BreakdownDraftValidationError
} from "./breakdown-draft.errors.js";

type BreakdownDraftDbClient = PrismaClient | Prisma.TransactionClient;
type AskRouterLike = Pick<AskRouterService, "askAcrossAnchor">;

export interface BreakdownDraftResult {
  draft: BreakdownDraft;
  hash: string;
}

export interface BreakdownDraftRejectAndFeedbackResult extends BreakdownDraftResult {
  ask: {
    jobId: string;
    submissionId: string | null;
    anchorId: string;
  };
}

export interface BreakdownDraftServiceOptions {
  now?: () => Date;
  askRouterService?: AskRouterLike;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

export function hashBreakdownDraft(draft: BreakdownDraft): string {
  return createHash("sha256").update(canonicalJson(draft)).digest("hex");
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortCanonical(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortCanonical(nested)])
    );
  }
  return value;
}

function parseDraft(value: unknown): BreakdownDraft {
  try {
    return breakdownDraftSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BreakdownDraftValidationError(error.issues.map((issue) => issue.message).join("; "));
    }
    throw error;
  }
}

function safeDraftFileName(id: string): string {
  return `${id.replace(/[\\/]/g, "_")}.json`;
}

function reviewEntry(input: {
  at: string;
  actor: "ai" | "user";
  action: BreakdownDraftReviewEntry["action"];
  note?: string;
}): BreakdownDraftReviewEntry {
  return input.note ? input : { at: input.at, actor: input.actor, action: input.action };
}

export class BreakdownDraftService {
  private readonly now: () => Date;
  private readonly askRouterService?: AskRouterLike;

  constructor(
    private readonly db: BreakdownDraftDbClient,
    options: BreakdownDraftServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.askRouterService = options.askRouterService;
  }

  async getDraft(requirementId: string): Promise<BreakdownDraftResult> {
    const requirement = await this.loadRequirement(requirementId);
    const draft = await this.readDraft(requirement.project.localPath, requirement.id);
    return { draft, hash: hashBreakdownDraft(draft) };
  }

  async createDraft(requirementId: string, value: unknown): Promise<BreakdownDraftResult> {
    const requirement = await this.loadRequirement(requirementId);
    const draft = this.normalizeDraft(parseDraft(value), requirement);
    await this.writeDraft(requirement.project.localPath, requirement.id, draft);
    await this.db.requirement.update({
      where: { id: requirement.id },
      data: {
        currentPlanningStep: "breakdown_draft",
        planningRuntimeState: "idle",
        breakdownDraftPath: this.relativeDraftPath(requirement.id)
      }
    });
    return { draft, hash: hashBreakdownDraft(draft) };
  }

  async updateDraft(requirementId: string, value: unknown, ifMatchHash: string): Promise<BreakdownDraftResult> {
    const current = await this.getDraft(requirementId);
    if (current.hash !== ifMatchHash) {
      throw new BreakdownDraftHashMismatchError();
    }
    const requirement = await this.loadRequirement(requirementId);
    const draft = this.normalizeDraft(parseDraft(value), requirement);
    await this.writeDraft(requirement.project.localPath, requirement.id, draft);
    return { draft, hash: hashBreakdownDraft(draft) };
  }

  async cancelDraft(requirementId: string): Promise<BreakdownDraftResult> {
    return await this.changeStatus(requirementId, "cancelled", "user", "status_changed");
  }

  async beginReview(requirementId: string): Promise<BreakdownDraftResult> {
    return await this.changeStatus(requirementId, "reviewing", "user", "status_changed");
  }

  async approve(requirementId: string, ifMatchHash: string, approvedBy: string): Promise<BreakdownDraftResult> {
    const current = await this.getDraft(requirementId);
    if (current.hash !== ifMatchHash) {
      throw new BreakdownDraftHashMismatchError();
    }
    const now = this.now().toISOString();
    const draft: BreakdownDraft = {
      ...current.draft,
      status: "approved",
      updated_at: now,
      approved_at: now,
      approved_by: approvedBy,
      review_history: [
        ...(current.draft.review_history ?? []),
        reviewEntry({ at: now, actor: "user", action: "status_changed", note: "approved" })
      ]
    };
    const requirement = await this.loadRequirement(requirementId);
    await this.writeDraft(requirement.project.localPath, requirement.id, draft);
    await this.db.requirement.update({
      where: { id: requirement.id },
      data: { currentPlanningStep: "ready_to_materialize", planningRuntimeState: "idle" }
    });
    return { draft, hash: hashBreakdownDraft(draft) };
  }

  async rejectAndFeedback(
    requirementId: string,
    ifMatchHash: string,
    reason: string,
    rejectedBy: string
  ): Promise<BreakdownDraftRejectAndFeedbackResult> {
    const current = await this.getDraft(requirementId);
    if (current.hash !== ifMatchHash) {
      throw new BreakdownDraftHashMismatchError();
    }
    const requirement = await this.loadRequirement(requirementId);
    const anchor = await this.db.anchorAllocation.findFirst({
      where: { subjectType: "requirement", subjectId: requirement.id, mode: "planning", state: { in: ["ready", "busy"] } },
      orderBy: { updatedAt: "desc" }
    });
    if (!anchor || !this.askRouterService) {
      throw new BreakdownDraftConflictError("requirement planning anchor unavailable");
    }
    const now = this.now().toISOString();
    const draft: BreakdownDraft = {
      ...current.draft,
      status: "draft",
      updated_at: now,
      review_history: [
        ...(current.draft.review_history ?? []),
        reviewEntry({ at: now, actor: "user", action: "rejected", note: reason })
      ]
    };
    await this.writeDraft(requirement.project.localPath, requirement.id, draft);
    const ask = await this.askRouterService.askAcrossAnchor({
      targetAnchorId: anchor.anchorId,
      toAgent: "ccb_claude",
      taskId: requirement.id,
      body: `/ccb:su-revise-breakdown requirement_id=${requirement.id}\n\n${reason}\n\nrejected_by=${rejectedBy}`
    });
    return {
      draft,
      hash: hashBreakdownDraft(draft),
      ask: { jobId: ask.jobId, submissionId: ask.submissionId ?? null, anchorId: anchor.anchorId }
    };
  }

  async markConsumed(requirementId: string, ifMatchHash: string): Promise<BreakdownDraftResult> {
    const current = await this.getDraft(requirementId);
    if (current.hash !== ifMatchHash) {
      throw new BreakdownDraftHashMismatchError();
    }
    return await this.changeStatus(requirementId, "consumed", "ai", "status_changed");
  }

  private async changeStatus(
    requirementId: string,
    status: BreakdownDraftStatus,
    actor: "ai" | "user",
    action: BreakdownDraftReviewEntry["action"]
  ): Promise<BreakdownDraftResult> {
    const current = await this.getDraft(requirementId);
    const requirement = await this.loadRequirement(requirementId);
    const now = this.now().toISOString();
    const draft: BreakdownDraft = {
      ...current.draft,
      status,
      updated_at: now,
      review_history: [...(current.draft.review_history ?? []), reviewEntry({ at: now, actor, action })]
    };
    if (status === "consumed") {
      draft.consumed_at = now;
      draft.consumed_by = "ccb_claude";
      draft.consumed_from_hash = current.hash;
    }
    await this.writeDraft(requirement.project.localPath, requirement.id, draft);
    return { draft, hash: hashBreakdownDraft(draft) };
  }

  private async loadRequirement(requirementId: string) {
    const requirement = await this.db.requirement.findUnique({
      where: { id: requirementId },
      select: {
        id: true,
        projectId: true,
        title: true,
        project: { select: { localPath: true } }
      }
    });
    if (!requirement) {
      throw new BreakdownDraftNotFoundError("requirement not found");
    }
    return requirement;
  }

  private normalizeDraft(
    draft: BreakdownDraft,
    requirement: { id: string; projectId: string; title: string }
  ): BreakdownDraft {
    const now = this.now().toISOString();
    const draftWithoutProjectId = { ...draft };
    delete draftWithoutProjectId.project_id;
    return {
      ...draftWithoutProjectId,
      requirement_id: requirement.id,
      carrier_task_id: requirement.id,
      carrier_task_key: requirement.title,
      updated_at: now,
      review_history: draft.review_history ?? [reviewEntry({ at: now, actor: "ai", action: "created" })]
    };
  }

  private draftPath(projectRoot: string, requirementId: string): string {
    return join(projectRoot, this.relativeDraftPath(requirementId));
  }

  private relativeDraftPath(requirementId: string): string {
    return join("docs", ".ccb", "drafts", "breakdown", safeDraftFileName(requirementId));
  }

  private async readDraft(projectRoot: string, requirementId: string): Promise<BreakdownDraft> {
    try {
      return parseDraft(JSON.parse(await readFile(this.draftPath(projectRoot, requirementId), "utf8")));
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "ENOENT") {
        throw new BreakdownDraftNotFoundError("breakdown draft not found");
      }
      if (error instanceof BreakdownDraftNotFoundError || error instanceof BreakdownDraftValidationError) {
        throw error;
      }
      throw new BreakdownDraftIoError(error instanceof Error ? error.message : "read breakdown draft failed");
    }
  }

  private async writeDraft(projectRoot: string, requirementId: string, draft: BreakdownDraft): Promise<void> {
    const path = this.draftPath(projectRoot, requirementId);
    const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await mkdir(join(projectRoot, "docs", ".ccb", "drafts", "breakdown"), { recursive: true });
    try {
      await writeFile(tempPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw new BreakdownDraftIoError(error instanceof Error ? error.message : "write breakdown draft failed");
    }
  }
}
