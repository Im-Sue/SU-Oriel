import type { PrismaClient, ProjectSettings } from "@prisma/client";

import { primitiveExecutor } from "../primitive/primitive-wrapper.js";
import { defaultProjectSettings, type ProjectSettingsPayload } from "./settings.schemas.js";

export interface ProjectSettingsResponse extends ProjectSettingsPayload {
  project_id: string;
  updated_at: string | null;
}

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeProjectSettings(projectId: string, settings: ProjectSettings | null): ProjectSettingsResponse {
  if (!settings) {
    return {
      project_id: projectId,
      ...defaultProjectSettings,
      updated_at: null
    };
  }

  return {
    project_id: projectId,
    scan_strategy: parseStoredJson(settings.scanStrategyJson, defaultProjectSettings.scan_strategy),
    parsing_rules: parseStoredJson(settings.parsingRulesJson, defaultProjectSettings.parsing_rules),
    path_config: parseStoredJson(settings.pathConfigJson, defaultProjectSettings.path_config),
    updated_at: settings.updatedAt.toISOString()
  };
}

export async function getProjectSettings(
  prisma: PrismaClient,
  projectId: string
): Promise<ProjectSettingsResponse | null> {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId
    },
    select: {
      id: true
    }
  });

  if (!project) {
    return null;
  }

  const settings = await prisma.projectSettings.findUnique({
    where: {
      projectId
    }
  });

  return serializeProjectSettings(projectId, settings);
}

export async function upsertProjectSettings(
  prisma: PrismaClient,
  projectId: string,
  payload: ProjectSettingsPayload
): Promise<ProjectSettingsResponse | null> {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId
    },
    select: {
      id: true
    }
  });

  if (!project) {
    return null;
  }

  const settings = await primitiveExecutor.run({
    primitive: "upsert_project_settings",
    mutationType: "prisma.projectSettings.upsert",
    idempotencyKey: `${projectId}:project_settings`,
    run: async () =>
      await prisma.projectSettings.upsert({
        where: {
          projectId
        },
        create: {
          projectId,
          scanStrategyJson: JSON.stringify(payload.scan_strategy),
          parsingRulesJson: JSON.stringify(payload.parsing_rules),
          pathConfigJson: JSON.stringify(payload.path_config)
        },
        update: {
          scanStrategyJson: JSON.stringify(payload.scan_strategy),
          parsingRulesJson: JSON.stringify(payload.parsing_rules),
          pathConfigJson: JSON.stringify(payload.path_config)
        }
      })
  });

  return serializeProjectSettings(projectId, settings);
}
