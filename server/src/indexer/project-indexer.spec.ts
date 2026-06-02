import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";
import { test } from "vitest";

import { deriveScanPhase } from "./project-indexer.js";

interface FakeSyncJob {
  id: string;
  projectId: string;
  jobType: string;
  status: string;
  startedAt: Date;
  createdAt: Date;
  errorMessage: string | null;
}

function fakePrisma(input: {
  lastScanAt: Date | null;
  jobs: FakeSyncJob[];
  forceCurrentPhaseEmpty?: boolean;
}): PrismaClient {
  let syncJobFindFirstCalls = 0;
  return {
    project: {
      findUnique: async () => ({
        lastScanAt: input.lastScanAt
      })
    },
    syncJob: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        syncJobFindFirstCalls += 1;
        if (input.forceCurrentPhaseEmpty && syncJobFindFirstCalls === 2) {
          return null;
        }
        const matched = input.jobs.filter((job) => {
          if (job.projectId !== where.projectId) return false;
          const jobType = where.jobType as string | { in: string[] } | undefined;
          if (typeof jobType === "string" && job.jobType !== jobType) return false;
          if (typeof jobType === "object" && !jobType.in.includes(job.jobType)) return false;
          const startedAt = where.startedAt as { gt?: Date; gte?: Date } | undefined;
          if (startedAt?.gt && !(job.startedAt > startedAt.gt)) return false;
          if (startedAt?.gte && !(job.startedAt >= startedAt.gte)) return false;
          return true;
        });
        return matched.sort((left, right) => {
          const startedDiff = right.startedAt.getTime() - left.startedAt.getTime();
          return startedDiff !== 0 ? startedDiff : right.createdAt.getTime() - left.createdAt.getTime();
        })[0] ?? null;
      }
    }
  } as unknown as PrismaClient;
}

function job(input: Partial<FakeSyncJob> & { id: string; jobType: string; startedAt: Date }): FakeSyncJob {
  return {
    projectId: "project-1",
    status: "running",
    createdAt: input.startedAt,
    errorMessage: null,
    ...input
  };
}

test("deriveScanPhase respects run boundary and ignores non-pipeline jobs", async () => {
  const scan = job({ id: "scan-1", jobType: "scan", startedAt: new Date("2026-06-02T01:00:00.000Z") });
  const parse = job({ id: "parse-1", jobType: "parse", startedAt: new Date("2026-06-02T01:01:00.000Z") });
  const generate = job({ id: "generate-1", jobType: "generate", startedAt: new Date("2026-06-02T01:02:00.000Z") });

  const phase = await deriveScanPhase(
    fakePrisma({
      lastScanAt: new Date("2026-06-02T00:59:00.000Z"),
      jobs: [scan, parse, generate]
    }),
    "project-1"
  );

  assert.deepEqual(phase, {
    phase: "parse",
    phaseStatus: "running",
    phaseJobId: "parse-1",
    phaseErrorMessage: null
  });
});

test("deriveScanPhase returns preparing when current phase lookup is empty", async () => {
  const phase = await deriveScanPhase(
    fakePrisma({
      lastScanAt: new Date("2026-06-02T00:59:00.000Z"),
      jobs: [job({ id: "scan-1", jobType: "scan", startedAt: new Date("2026-06-02T01:00:00.000Z") })],
      forceCurrentPhaseEmpty: true
    }),
    "project-1"
  );

  assert.deepEqual(phase, {
    phase: "preparing",
    phaseStatus: null,
    phaseJobId: null,
    phaseErrorMessage: null
  });
});

test("deriveScanPhase exposes partial as phase status only", async () => {
  const phase = await deriveScanPhase(
    fakePrisma({
      lastScanAt: new Date("2026-06-02T00:59:00.000Z"),
      jobs: [
        job({ id: "scan-1", jobType: "scan", status: "success", startedAt: new Date("2026-06-02T01:00:00.000Z") }),
        job({
          id: "requirement-sync-1",
          jobType: "requirement_sync",
          status: "partial",
          errorMessage: "missing_id",
          startedAt: new Date("2026-06-02T01:01:00.000Z")
        })
      ]
    }),
    "project-1"
  );

  assert.deepEqual(phase, {
    phase: "requirement_sync",
    phaseStatus: "partial",
    phaseJobId: "requirement-sync-1",
    phaseErrorMessage: "missing_id"
  });
});

test("deriveScanPhase treats null lastScanAt as first scan", async () => {
  const phase = await deriveScanPhase(
    fakePrisma({
      lastScanAt: null,
      jobs: [job({ id: "scan-1", jobType: "scan", startedAt: new Date("2026-06-02T01:00:00.000Z") })]
    }),
    "project-1"
  );

  assert.equal(phase.phase, "scan");
  assert.equal(phase.phaseJobId, "scan-1");
});

test("deriveScanPhase returns null phase after the run has ended", async () => {
  const phase = await deriveScanPhase(
    fakePrisma({
      lastScanAt: new Date("2026-06-02T01:05:00.000Z"),
      jobs: [job({ id: "scan-1", jobType: "scan", startedAt: new Date("2026-06-02T01:00:00.000Z") })]
    }),
    "project-1"
  );

  assert.deepEqual(phase, {
    phase: null,
    phaseStatus: null,
    phaseJobId: null,
    phaseErrorMessage: null
  });
});
