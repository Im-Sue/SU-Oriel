import type { ExecutorProfile, PrismaClient } from "@prisma/client";

import { primitiveExecutor } from "../primitive/primitive-wrapper.js";
import type { ExecutorProfilePayload } from "./executor-profile.schemas.js";

export interface ExecutorProfileResponse extends ExecutorProfilePayload {
  project_id: string;
  profile_id: string;
}

function parseStoredJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeExecutorProfile(record: ExecutorProfile): ExecutorProfileResponse {
  const response: ExecutorProfileResponse = {
    project_id: record.projectId,
    profile_id: record.name,
    version: "executor-profile-v0.1",
    provider: record.provider,
    model: record.model,
    runtime: record.runtime as ExecutorProfilePayload["runtime"],
    permission: record.permission as ExecutorProfilePayload["permission"],
    capability_binding: parseStoredJson(record.capabilityBindingJson, {
      capability_id: ""
    }),
    last_updated: record.updatedAt.toISOString()
  };
  const meta = parseStoredJson<Record<string, unknown> | null>(record.metaJson, null);
  if (meta) {
    response.meta = meta;
  }
  return response;
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

export async function listExecutorProfiles(
  prisma: PrismaClient,
  projectId: string
): Promise<ExecutorProfileResponse[] | null> {
  if (!(await projectExists(prisma, projectId))) {
    return null;
  }
  const profiles = await prisma.executorProfile.findMany({
    where: {
      projectId
    },
    orderBy: {
      name: "asc"
    }
  });
  return profiles.map(serializeExecutorProfile);
}

export async function getExecutorProfile(
  prisma: PrismaClient,
  projectId: string,
  profileId: string
): Promise<ExecutorProfileResponse | null> {
  const profile = await prisma.executorProfile.findUnique({
    where: {
      projectId_name: {
        projectId,
        name: profileId
      }
    }
  });
  return profile ? serializeExecutorProfile(profile) : null;
}

export async function upsertExecutorProfile(
  prisma: PrismaClient,
  projectId: string,
  profileId: string,
  payload: ExecutorProfilePayload
): Promise<ExecutorProfileResponse | null> {
  if (!(await projectExists(prisma, projectId))) {
    return null;
  }
  const profile = await primitiveExecutor.run({
    primitive: "upsert_executor_profile",
    mutationType: "prisma.executorProfile.upsert",
    idempotencyKey: `${projectId}:executor_profile:${profileId}`,
    run: async () =>
      await prisma.executorProfile.upsert({
        where: {
          projectId_name: {
            projectId,
            name: profileId
          }
        },
        create: {
          projectId,
          name: profileId,
          provider: payload.provider,
          model: payload.model,
          runtime: payload.runtime,
          permission: payload.permission,
          capabilityBindingJson: JSON.stringify(payload.capability_binding),
          version: payload.version,
          metaJson: payload.meta ? JSON.stringify(payload.meta) : null
        },
        update: {
          provider: payload.provider,
          model: payload.model,
          runtime: payload.runtime,
          permission: payload.permission,
          capabilityBindingJson: JSON.stringify(payload.capability_binding),
          version: payload.version,
          metaJson: payload.meta ? JSON.stringify(payload.meta) : null
        }
      })
  });
  return serializeExecutorProfile(profile);
}
