import { randomUUID } from "node:crypto";

import type { CreateProjectInput, ProjectRecord, ProjectStore } from "./project.types.js";

/**
 * 当前阶段先用内存仓储打通项目管理主链路，
 * 后续再平滑切到 Prisma 持久化实现。
 */
export class InMemoryProjectStore implements ProjectStore {
  private readonly records: ProjectRecord[] = [];

  async list(): Promise<ProjectRecord[]> {
    return [...this.records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const now = new Date().toISOString();
    const record: ProjectRecord = {
      id: randomUUID(),
      name: input.name,
      localPath: input.localPath,
      summary: input.summary ?? null,
      initStatus: "not_initialized",
      docsRoot: null,
      lastScanAt: null,
      syncStatus: "idle",
      ownerUserId: null,
      createdAt: now,
      updatedAt: now
    };

    this.records.push(record);
    return record;
  }
}
