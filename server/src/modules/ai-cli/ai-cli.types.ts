export const AI_CLI_TOOLS = ["claude", "codex", "gemini"] as const;
export type AiCliToolId = (typeof AI_CLI_TOOLS)[number];

export type AiCliLaunchMode = "external" | "embedded";

export interface AiCliToolDefinition {
  id: AiCliToolId;
  name: string;
  defaultCommand: string;
  defaultArgs: string[];
  installHint: string;
}

export interface AiCliToolResolved {
  id: AiCliToolId;
  name: string;
  command: string;
  resolvedPath: string | null;
  available: boolean;
  args: string[];
  defaultMode: AiCliLaunchMode | null;
  installHint: string;
}

export interface AiCliSettingRecord {
  scope: "global" | "project";
  projectId: string | null;
  toolId: AiCliToolId;
  command: string | null;
  extraArgs: string[];
  defaultMode: AiCliLaunchMode | null;
}

export interface AiCliLaunchInput {
  toolId: AiCliToolId;
  projectId?: string | null;
}

export interface AiCliLaunchResult {
  toolId: AiCliToolId;
  command: string;
  cwd: string;
  terminalKind: string;
  pid: number | null;
}
