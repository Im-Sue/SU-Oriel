import type { ExecutorProfile, PrismaClient, RoleProfile } from "@prisma/client";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveCcbProjectRoot } from "../../lib/project-root.js";

import type { RoleProfilePayload } from "./role-profile.schemas.js";

const execFileAsync = promisify(execFile);
const currentDir = dirname(fileURLToPath(import.meta.url));
// sourceRoot 资源：prompt 校验脚本是 console 自带脚本（su-oriel/server/scripts）
const promptValidatorScript = resolve(currentDir, "../../../scripts/validate-prompt-template.cjs");
// projectRoot 数据：prompt 模板属于被观测项目，动态解析不受目录深度影响
const projectRoot = resolveCcbProjectRoot();
const promptRoot = resolve(projectRoot, "docs/.ccb/templates/prompts");

export interface RoleProfileResponse extends RoleProfilePayload {
  project_id: string;
  role_id: string;
  updated_at: string;
}

export interface RoleProfileValidationFailure {
  ok: false;
  message: string;
  issues?: unknown;
}

export interface RoleProfileValidationSuccess {
  ok: true;
  executorProfile: ExecutorProfile;
}

export type RoleProfileValidationResult = RoleProfileValidationFailure | RoleProfileValidationSuccess;

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeRoleProfile(record: RoleProfile & { executorProfile: ExecutorProfile }): RoleProfileResponse {
  return {
    project_id: record.executorProfile.projectId,
    role_id: record.name,
    version: "role-profile-v0.1",
    name: record.name,
    executor_profile_id: record.executorProfileId,
    prompt_template_ref: record.promptTemplateRef,
    variable_overrides: parseStoredJson(record.variableOverridesJson, {}),
    updated_at: record.updatedAt.toISOString()
  };
}

async function projectExists(prisma: PrismaClient, projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId
    },
    select: {
      id: true
    }
  });
  return Boolean(project);
}

function resolvePromptTemplateRef(promptTemplateRef: string): string {
  return resolve(projectRoot, promptTemplateRef);
}

async function validatePromptTemplateFrontmatter(templatePath: string): Promise<RoleProfileValidationFailure | null> {
  try {
    await execFileAsync("node", [promptValidatorScript, templatePath], {
      cwd: projectRoot
    });
    return null;
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    return {
      ok: false,
      message: `template_ref frontmatter invalid: ${stderr.trim() || "validation failed"}`
    };
  }
}

export async function validateRoleProfileReferences(
  prisma: PrismaClient,
  projectId: string,
  payload: RoleProfilePayload
): Promise<RoleProfileValidationResult> {
  const templatePath = resolvePromptTemplateRef(payload.prompt_template_ref);
  if (!templatePath.startsWith(promptRoot) || !existsSync(templatePath)) {
    return {
      ok: false,
      message: `template_ref not found: ${payload.prompt_template_ref}`
    };
  }

  const frontmatterFailure = await validatePromptTemplateFrontmatter(templatePath);
  if (frontmatterFailure) {
    return frontmatterFailure;
  }

  const executorProfile = await prisma.executorProfile.findUnique({
    where: {
      id: payload.executor_profile_id
    }
  });
  if (!executorProfile || executorProfile.projectId !== projectId) {
    return {
      ok: false,
      message: `executor_profile_id not found: ${payload.executor_profile_id}`
    };
  }

  return {
    ok: true,
    executorProfile
  };
}

export async function listRoleProfiles(prisma: PrismaClient, projectId: string): Promise<RoleProfileResponse[] | null> {
  if (!(await projectExists(prisma, projectId))) {
    return null;
  }
  const roles = await prisma.roleProfile.findMany({
    where: {
      executorProfile: {
        projectId
      }
    },
    include: {
      executorProfile: true
    },
    orderBy: {
      name: "asc"
    }
  });
  return roles.map(serializeRoleProfile);
}

export async function getRoleProfile(
  prisma: PrismaClient,
  projectId: string,
  roleId: string
): Promise<RoleProfileResponse | null> {
  const role = await prisma.roleProfile.findFirst({
    where: {
      name: roleId,
      executorProfile: {
        projectId
      }
    },
    include: {
      executorProfile: true
    }
  });
  return role ? serializeRoleProfile(role) : null;
}

export async function upsertRoleProfile(
  prisma: PrismaClient,
  projectId: string,
  roleId: string,
  payload: RoleProfilePayload,
  executorProfile: ExecutorProfile
): Promise<RoleProfileResponse | null> {
  const existing = await prisma.roleProfile.findFirst({
    where: {
      name: roleId,
      executorProfile: {
        projectId
      }
    },
    select: {
      id: true
    }
  });

  const data = {
    executorProfileId: executorProfile.id,
    name: roleId,
    promptTemplateRef: payload.prompt_template_ref,
    variableOverridesJson: JSON.stringify(payload.variable_overrides),
    version: payload.version
  };

  const role = existing
    ? await prisma.roleProfile.update({
        where: {
          id: existing.id
        },
        data,
        include: {
          executorProfile: true
        }
      })
    : await prisma.roleProfile.create({
        data,
        include: {
          executorProfile: true
        }
      });

  return serializeRoleProfile(role);
}
