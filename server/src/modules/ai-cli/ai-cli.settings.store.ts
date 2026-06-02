import type { PrismaClient } from "@prisma/client";

import { AI_CLI_TOOL_DEFINITIONS, isAiCliToolId } from "./ai-cli.registry.js";
import type {
  AiCliLaunchMode,
  AiCliSettingRecord,
  AiCliToolId
} from "./ai-cli.types.js";

export interface AiCliSettingUpsertInput {
  scope: "global" | "project";
  projectId: string | null;
  toolId: AiCliToolId;
  command: string | null;
  extraArgs: string[];
  defaultMode: AiCliLaunchMode | null;
}

export class AiCliSettingsStore {
  public constructor(private readonly client: PrismaClient) {}

  async list(): Promise<AiCliSettingRecord[]> {
    const rows = await this.client.aiCliSetting.findMany({
      orderBy: [{ scope: "asc" }, { toolId: "asc" }]
    });
    return rows.map(toSettingRecord);
  }

  async listForProject(projectId: string | null): Promise<AiCliSettingRecord[]> {
    const rows = await this.client.aiCliSetting.findMany({
      where: projectId
        ? { OR: [{ scope: "global" }, { scope: "project", projectId }] }
        : { scope: "global" }
    });
    return rows.map(toSettingRecord);
  }

  async upsert(input: AiCliSettingUpsertInput): Promise<AiCliSettingRecord> {
    if (input.scope === "project" && !input.projectId) {
      throw new Error("project scope 必须提供 projectId");
    }

    const trimmedCommand = input.command?.trim();
    const projectId = input.scope === "project" ? input.projectId : null;
    const data = {
      scope: input.scope,
      projectId,
      toolId: input.toolId,
      command: trimmedCommand && trimmedCommand.length > 0 ? trimmedCommand : null,
      extraArgs: input.extraArgs.length > 0 ? JSON.stringify(input.extraArgs) : null,
      defaultMode: input.defaultMode
    };

    // SQLite 复合唯一键里的 NULL 值不会被视为相等（NULL ≠ NULL），
    // 所以这里手动 findFirst + create/update，避免出现重复的 global 行。
    const existing = await this.client.aiCliSetting.findFirst({
      where: { scope: data.scope, projectId: data.projectId, toolId: data.toolId }
    });

    const row = existing
      ? await this.client.aiCliSetting.update({
          where: { id: existing.id },
          data: {
            command: data.command,
            extraArgs: data.extraArgs,
            defaultMode: data.defaultMode
          }
        })
      : await this.client.aiCliSetting.create({ data });

    return toSettingRecord(row);
  }

  async remove(scope: "global" | "project", projectId: string | null, toolId: AiCliToolId): Promise<void> {
    await this.client.aiCliSetting.deleteMany({
      where: {
        scope,
        projectId,
        toolId
      }
    });
  }
}

/**
 * 计算指定 tool 当前生效的「命令 / 参数 / 默认模式」。
 * 优先级：project 覆盖 > global 覆盖 > registry 默认。
 */
export function resolveEffectiveSetting(
  toolId: AiCliToolId,
  projectId: string | null,
  records: AiCliSettingRecord[]
): { command: string; extraArgs: string[]; defaultMode: AiCliLaunchMode | null } {
  const def = AI_CLI_TOOL_DEFINITIONS[toolId];
  const projectRecord = projectId
    ? records.find((row) => row.scope === "project" && row.projectId === projectId && row.toolId === toolId)
    : undefined;
  const globalRecord = records.find((row) => row.scope === "global" && row.toolId === toolId);

  const command = projectRecord?.command ?? globalRecord?.command ?? def.defaultCommand;
  const extraArgs =
    projectRecord && projectRecord.extraArgs.length > 0
      ? projectRecord.extraArgs
      : globalRecord?.extraArgs.length
        ? globalRecord.extraArgs
        : def.defaultArgs;
  const defaultMode = projectRecord?.defaultMode ?? globalRecord?.defaultMode ?? null;

  return { command, extraArgs, defaultMode };
}

interface AiCliSettingRow {
  scope: string;
  projectId: string | null;
  toolId: string;
  command: string | null;
  extraArgs: string | null;
  defaultMode: string | null;
}

function toSettingRecord(row: AiCliSettingRow): AiCliSettingRecord {
  if (!isAiCliToolId(row.toolId)) {
    throw new Error(`数据库中存在未知 toolId: ${row.toolId}`);
  }
  if (row.scope !== "global" && row.scope !== "project") {
    throw new Error(`数据库中存在未知 scope: ${row.scope}`);
  }
  const defaultMode = row.defaultMode === "external" || row.defaultMode === "embedded" ? row.defaultMode : null;
  return {
    scope: row.scope,
    projectId: row.projectId,
    toolId: row.toolId,
    command: row.command,
    extraArgs: parseExtraArgs(row.extraArgs),
    defaultMode
  };
}

function parseExtraArgs(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // 损坏的旧值忽略，按空数组处理。
  }
  return [];
}
