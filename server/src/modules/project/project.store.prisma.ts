import type { PrismaClient } from "@prisma/client";

import { mapProjectRecord } from "./project.mapper.js";
import type { CreateProjectInput, ProjectRecord, ProjectStore } from "./project.types.js";

/**
 * Prisma 持久化仓储。
 * 当前阶段先覆盖项目创建和查询，后续扫描、初始化状态更新也在这里继续扩展。
 */
export class PrismaProjectStore implements ProjectStore {
  public constructor(private readonly client: PrismaClient) {}

  async list(): Promise<ProjectRecord[]> {
    const records = await this.client.project.findMany({
      orderBy: {
        createdAt: "desc"
      }
    });

    return records.map(mapProjectRecord);
  }

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const record = await this.client.project.create({
      data: {
        name: input.name,
        localPath: input.localPath,
        summary: input.summary?.trim() ? input.summary.trim() : null
      }
    });

    return mapProjectRecord(record);
  }
}
