import { buildApiUrl } from "./console-api.js";
import type {
  AiCliLaunchMode,
  AiCliLaunchResult,
  AiCliSettingView,
  AiCliToolId,
  AiCliToolView,
  CreateSessionResult,
  PtySessionDescriptorView,
  RecordingMetaView,
  RecordingPayload
} from "../types/ai-cli.js";

interface ListResponse<T> {
  items: T[];
}

interface ApiErrorBody {
  message?: string;
  code?: string;
  installHint?: string;
}

export class AiCliApiError extends Error {
  public readonly code: string | null;
  public readonly installHint: string | null;
  public constructor(message: string, code: string | null, installHint: string | null) {
    super(message);
    this.code = code;
    this.installHint = installHint;
  }
}

async function parseError(response: Response, fallback: string): Promise<AiCliApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new AiCliApiError(body.message?.trim() || fallback, body.code ?? null, body.installHint ?? null);
  } catch {
    return new AiCliApiError(fallback, null, null);
  }
}

export async function fetchAiCliTools(projectId: string | null): Promise<AiCliToolView[]> {
  const search = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(buildApiUrl(`/api/ai-cli/tools${search}`));
  if (!response.ok) {
    throw await parseError(response, "加载 AI CLI 工具列表失败");
  }
  const payload = (await response.json()) as ListResponse<AiCliToolView>;
  return payload.items;
}

export async function fetchAiCliSettings(): Promise<AiCliSettingView[]> {
  const response = await fetch(buildApiUrl("/api/ai-cli/settings"));
  if (!response.ok) {
    throw await parseError(response, "加载 AI CLI 设置失败");
  }
  const payload = (await response.json()) as ListResponse<AiCliSettingView>;
  return payload.items;
}

export async function upsertAiCliSetting(input: {
  scope: "global" | "project";
  projectId: string | null;
  toolId: AiCliToolId;
  command: string | null;
  extraArgs: string[];
  defaultMode: AiCliLaunchMode | null;
}): Promise<AiCliSettingView> {
  const response = await fetch(buildApiUrl("/api/ai-cli/settings"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw await parseError(response, "保存 AI CLI 设置失败");
  }
  return (await response.json()) as AiCliSettingView;
}

export async function deleteAiCliSetting(input: {
  scope: "global" | "project";
  projectId: string | null;
  toolId: AiCliToolId;
}): Promise<void> {
  const response = await fetch(buildApiUrl("/api/ai-cli/settings"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok && response.status !== 204) {
    throw await parseError(response, "删除 AI CLI 设置失败");
  }
}

export async function launchAiCliExternal(input: {
  toolId: AiCliToolId;
  projectId: string | null;
}): Promise<AiCliLaunchResult> {
  const response = await fetch(buildApiUrl("/api/ai-cli/launch"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw await parseError(response, "启动 AI CLI 失败");
  }
  return (await response.json()) as AiCliLaunchResult;
}

export async function createAiCliSession(input: {
  toolId: AiCliToolId;
  projectId: string | null;
  cols?: number;
  rows?: number;
  shellWrap?: boolean;
  record?: boolean;
}): Promise<CreateSessionResult> {
  const response = await fetch(buildApiUrl("/api/ai-cli/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw await parseError(response, "创建嵌入式会话失败");
  }
  return (await response.json()) as CreateSessionResult;
}

export async function fetchAiCliSessions(): Promise<PtySessionDescriptorView[]> {
  const response = await fetch(buildApiUrl("/api/ai-cli/sessions"));
  if (!response.ok) {
    throw await parseError(response, "加载会话列表失败");
  }
  const payload = (await response.json()) as ListResponse<PtySessionDescriptorView>;
  return payload.items;
}

export async function deleteAiCliSession(sessionId: string): Promise<void> {
  const response = await fetch(buildApiUrl(`/api/ai-cli/sessions/${encodeURIComponent(sessionId)}`), {
    method: "DELETE"
  });
  if (!response.ok && response.status !== 204) {
    throw await parseError(response, "关闭会话失败");
  }
}

export async function fetchAiCliRecordings(): Promise<RecordingMetaView[]> {
  const response = await fetch(buildApiUrl("/api/ai-cli/recordings"));
  if (!response.ok) {
    throw await parseError(response, "加载会话录像列表失败");
  }
  const payload = (await response.json()) as ListResponse<RecordingMetaView>;
  return payload.items;
}

export async function fetchAiCliRecording(id: string): Promise<RecordingPayload> {
  const response = await fetch(buildApiUrl(`/api/ai-cli/recordings/${encodeURIComponent(id)}`));
  if (!response.ok) {
    throw await parseError(response, "加载会话录像失败");
  }
  return (await response.json()) as RecordingPayload;
}

export async function deleteAiCliRecording(id: string): Promise<void> {
  const response = await fetch(buildApiUrl(`/api/ai-cli/recordings/${encodeURIComponent(id)}`), {
    method: "DELETE"
  });
  if (!response.ok && response.status !== 204) {
    throw await parseError(response, "删除会话录像失败");
  }
}
