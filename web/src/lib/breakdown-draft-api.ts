// Requirement breakdown draft API client.

export type BreakdownDraftStatus = "draft" | "reviewing" | "approved" | "consumed" | "cancelled";

export type ImplementationOwner = "claude" | "ccb_codex";

export interface BreakdownDraftSubtask {
  section_id: string;
  order: number;
  title: string;
  summary: string;
  spec_section_md: string;
  priority: "high" | "medium" | "low";
  implementation_owner: ImplementationOwner;
  dependencies: string[];
  include: boolean;
}

export interface BreakdownDraftPlan {
  title: string;
  summary: string;
  spec_outline_md: string;
  estimated_total_days?: number | null;
}

export type BreakdownDraftReviewAction = "created" | "edited" | "status_changed" | "rejected";

export interface BreakdownDraftReviewHistoryItem {
  at: string;
  actor: "ai" | "user";
  action: BreakdownDraftReviewAction | string;
  note?: string;
}

export interface BreakdownDraft {
  schema_version: "breakdown-draft-v0.2";
  status: BreakdownDraftStatus;
  project_id: string;
  requirement_id: string;
  carrier_task_id: string;
  carrier_task_key: string;
  base_task_revision: number | null;
  generated_at: string;
  updated_at: string;
  generated_by: "ai_session" | "manual";
  generation_source: {
    cc_agent?: string;
    cx_agent?: string;
    ccb_job_id?: string;
    manual_actor?: string;
  };
  plan: BreakdownDraftPlan;
  subtasks: BreakdownDraftSubtask[];
  review_history: BreakdownDraftReviewHistoryItem[];
  approved_at?: string;
  approved_by?: string;
}

export interface BreakdownDraftResult {
  draft: BreakdownDraft;
  hash: string;
}

export interface AnchorDispatchResponse {
  jobId: string;
  job_id?: string;
  anchorId: string;
  subjectId?: string;
  requirementId?: string;
  queuedAt?: string;
  status: string;
}

export interface MaterializeResult {
  requirementId: string;
  subtaskIds: string[];
  planSpecPath: string;
  eventId: string;
}

export class BreakdownDraftApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "BreakdownDraftApiError";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body?.message) return body.message;
  } catch {
    /* fall through */
  }
  return `${response.status} ${response.statusText}`;
}

export async function fetchBreakdownDraft(requirementId: string): Promise<BreakdownDraftResult | null> {
  const response = await fetch(`/api/requirements/${encodeURIComponent(requirementId)}/breakdown-draft`);
  if (response.status === 404) return null;
  if (!response.ok) throw new BreakdownDraftApiError(response.status, await readError(response));
  return (await response.json()) as BreakdownDraftResult;
}

async function dispatchBreakdownDraftCommand(
  projectId: string,
  requirementId: string,
  input: {
    command: string;
    payload: Record<string, unknown>;
  }
): Promise<AnchorDispatchResponse> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}/anchor-dispatch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  if (!response.ok) throw new BreakdownDraftApiError(response.status, await readError(response));
  return (await response.json()) as AnchorDispatchResponse;
}

export async function createBreakdownDraft(
  projectId: string,
  requirementId: string
): Promise<AnchorDispatchResponse> {
  return await dispatchBreakdownDraftCommand(projectId, requirementId, {
    command: "su-flow",
    payload: { action: "breakdown_draft_create", step: "breakdown_draft" }
  });
}

export async function updateBreakdownDraft(
  projectId: string,
  requirementId: string,
  ifMatchHash: string
): Promise<AnchorDispatchResponse> {
  return await dispatchBreakdownDraftCommand(projectId, requirementId, {
    command: "su-flow",
    payload: { action: "breakdown_draft_update", expected_hash: ifMatchHash, step: "breakdown_draft" }
  });
}

export async function cancelBreakdownDraft(
  projectId: string,
  requirementId: string
): Promise<AnchorDispatchResponse> {
  return await dispatchBreakdownDraftCommand(projectId, requirementId, {
    command: "su-cancel",
    payload: { action: "breakdown_draft_delete" }
  });
}

export async function beginReview(
  projectId: string,
  requirementId: string
): Promise<AnchorDispatchResponse> {
  return await dispatchBreakdownDraftCommand(projectId, requirementId, {
    command: "su-flow",
    payload: { action: "breakdown_draft_begin_review", step: "breakdown_draft" }
  });
}

export async function approveBreakdownDraft(
  projectId: string,
  requirementId: string,
  ifMatchHash: string
): Promise<AnchorDispatchResponse> {
  return await dispatchBreakdownDraftCommand(projectId, requirementId, {
    command: "su-approve",
    payload: { action: "breakdown_draft_approve", expected_hash: ifMatchHash }
  });
}

export async function materializeRequirement(
  projectId: string,
  requirementId: string,
  expectedDraftHash: string
): Promise<AnchorDispatchResponse> {
  return await dispatchBreakdownDraftCommand(projectId, requirementId, {
    command: "su-materialize-requirement",
    payload: {
      requirement_id: requirementId,
      expected_hash: expectedDraftHash
    }
  });
}

export interface RejectFeedbackResult {
  jobId: string;
  anchorId: string;
  status: string;
}

export async function rejectAndFeedback(
  projectId: string,
  requirementId: string,
  reason: string,
  expectedDraftHash: string
): Promise<RejectFeedbackResult> {
  return await dispatchBreakdownDraftCommand(projectId, requirementId, {
    command: "su-revise-breakdown",
    payload: {
      action: "breakdown_draft_reject",
      expected_hash: expectedDraftHash,
      feedback: {
        summary: reason
      }
    }
  });
}
