export type UserIntentType = "append_instruction" | "change_direction" | "pause";

export interface PendingIntentView {
  id: string;
  intentType: UserIntentType;
  body: string;
  createdAt: string;
  ccbJobId: string | null;
}

export interface StopAndAppendResult {
  intentId: string;
  cancelledJobId: string | null;
  slotId: string | null;
  slotState: string | null;
}

export interface ResumeResult {
  slotId: string;
  slotState: string;
  jobId: string | null;
  intentId: string;
  intentType: UserIntentType;
  body: string;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body?.message) return body.message;
  } catch {
    // fall through
  }
  return `${response.status} ${response.statusText}`;
}

export async function stopAndAppend(
  taskId: string,
  payload: { intentType: UserIntentType; body: string; ccbJobId?: string | null }
): Promise<StopAndAppendResult> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/stop-and-append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as StopAndAppendResult;
}

export async function resumeWithIntent(taskId: string): Promise<ResumeResult> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as ResumeResult;
}

export async function fetchPendingIntent(taskId: string): Promise<PendingIntentView | null> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/pending-intent`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = (await response.json()) as { pendingIntent: PendingIntentView | null };
  return body.pendingIntent;
}
