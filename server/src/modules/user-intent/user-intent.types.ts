export const USER_INTENT_TYPES = [
  "append_instruction",
  "change_direction",
  "pause"
] as const;

export type UserIntentType = (typeof USER_INTENT_TYPES)[number];

export interface UserIntentView {
  id: string;
  taskId: string;
  ccbJobId: string | null;
  intentType: UserIntentType;
  body: string;
  createdAt: string;
  consumedAt: string | null;
}

export interface StopAndAppendInput {
  intentType: UserIntentType;
  body: string;
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
  intentId: string | null;
  intentType: UserIntentType;
  body: string;
}
