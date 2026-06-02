export const AI_CLI_TOOL_IDS = ["claude", "codex", "gemini"] as const;
export type AiCliToolId = (typeof AI_CLI_TOOL_IDS)[number];

export type AiCliLaunchMode = "external" | "embedded";

export interface AiCliToolView {
  id: AiCliToolId;
  name: string;
  command: string;
  resolvedPath: string | null;
  available: boolean;
  args: string[];
  defaultMode: AiCliLaunchMode | null;
  installHint: string;
}

export interface AiCliSettingView {
  scope: "global" | "project";
  projectId: string | null;
  toolId: AiCliToolId;
  command: string | null;
  extraArgs: string[];
  defaultMode: AiCliLaunchMode | null;
}

export interface AiCliLaunchResult {
  toolId: AiCliToolId;
  command: string;
  cwd: string;
  terminalKind: string;
  pid: number | null;
}

export interface AiCliSettingFormValue {
  command: string;
  extraArgsText: string;
  defaultMode: AiCliLaunchMode | "inherit";
}

export type PtySessionStatus = "starting" | "running" | "exited";

export interface PtySessionDescriptorView {
  id: string;
  toolId: AiCliToolId;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  projectId: string | null;
  createdAt: string;
  lastActiveAt: string;
  status: PtySessionStatus;
  exitCode: number | null;
  exitSignal: string | null;
  recordingId: string | null;
  attachedSocketCount: number;
}

export interface CreateSessionResult {
  descriptor: PtySessionDescriptorView;
  wsPath: string;
}

export interface RecordingMetaView {
  id: string;
  toolId: AiCliToolId;
  projectId: string | null;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  finishedAt: string | null;
  byteSize: number;
}

export interface RecordingPayload {
  meta: RecordingMetaView;
  cast: string;
}
