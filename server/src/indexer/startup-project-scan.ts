import type { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { scanProject } from "./project-indexer.js";

interface StartupScanLogger {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
}

export interface StartupProjectScanLifecycle {
  start: () => Promise<void>;
}

export class StartupProjectScanService implements StartupProjectScanLifecycle {
  public constructor(
    private readonly options: {
      prisma: PrismaClient;
      logger?: StartupScanLogger;
    }
  ) {}

  public async start(): Promise<void> {
    const projects = await this.options.prisma.project.findMany({
      select: {
        id: true,
        name: true,
        localPath: true,
        lastScanAt: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    for (const project of projects) {
      try {
        if (!(await shouldScanProjectOnStartup(project.localPath, project.lastScanAt))) {
          this.options.logger?.info(
            { event: "indexer.startup_scan.skipped", projectId: project.id, lastScanAt: project.lastScanAt },
            "startup project scan skipped; no changed files since last scan"
          );
          continue;
        }
        await scanProject(this.options.prisma, project.id);
        this.options.logger?.info(
          { event: "indexer.startup_scan.completed", projectId: project.id, lastScanAt: project.lastScanAt },
          "startup project scan completed"
        );
      } catch (error) {
        this.options.logger?.warn(
          {
            event: "indexer.startup_scan.failed",
            projectId: project.id,
            projectName: project.name,
            err: error
          },
          "startup project scan failed; server will continue"
        );
      }
    }
  }
}

export async function shouldScanProjectOnStartup(localPath: string, lastScanAt: Date | null): Promise<boolean> {
  if (!lastScanAt) {
    return true;
  }

  const docsRoot = join(localPath, "docs");
  if (!existsSync(docsRoot)) {
    return true;
  }

  return await hasFileModifiedAfter(docsRoot, lastScanAt.getTime());
}

async function hasFileModifiedAfter(rootPath: string, cutoffMs: number): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return true;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (await hasFileModifiedAfter(entryPath, cutoffMs)) {
        return true;
      }
      continue;
    }
    if (!entry.isFile() || !isStartupScanWatchedFile(entry.name)) {
      continue;
    }
    const fileStats = await stat(entryPath);
    if (fileStats.mtime.getTime() > cutoffMs) {
      return true;
    }
  }

  return false;
}

function isStartupScanWatchedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".json");
}
