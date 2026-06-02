import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { PrismaClient } from "@prisma/client";

export interface ResolvedCwd {
  cwd: string;
  projectId: string | null;
  projectName: string | null;
}

/**
 * 校验并解析启动 cwd。
 * - 不传 projectId：使用 process.cwd()
 * - 传 projectId：必须存在于 DB；使用其 localPath，并 realpath + 目录类型校验
 *
 * 严禁让前端直接传任意路径——这是命令注入与越权访问的关键防线。
 */
export async function resolveLaunchCwd(
  prisma: PrismaClient,
  projectId: string | null | undefined
): Promise<ResolvedCwd> {
  if (!projectId) {
    return {
      cwd: process.cwd(),
      projectId: null,
      projectName: null
    };
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new CwdInvalidError(`未找到项目：${projectId}`);
  }

  const absolute = resolve(project.localPath);
  let real: string;
  try {
    real = realpathSync(absolute);
  } catch {
    throw new CwdInvalidError(`项目本地路径不存在：${project.localPath}`);
  }

  let stats;
  try {
    stats = statSync(real);
  } catch {
    throw new CwdInvalidError(`项目本地路径无法访问：${project.localPath}`);
  }
  if (!stats.isDirectory()) {
    throw new CwdInvalidError(`项目本地路径不是目录：${project.localPath}`);
  }

  return {
    cwd: real,
    projectId: project.id,
    projectName: project.name
  };
}

export class CwdInvalidError extends Error {
  public readonly code = "CWD_INVALID";
}
