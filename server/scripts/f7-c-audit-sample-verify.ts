import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface CountRow {
  count: number | bigint;
}

interface AuditSampleRow {
  id: string;
  primitive: string | null;
  mutationType: string | null;
  status: string | null;
  resultJson: string | null;
  errorJson: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  durationMs: number | bigint | null;
}

const sampleSize = 10;
const dbPath = resolve("prisma/test.db");

if (!existsSync(dbPath)) {
  throw new Error(`test database not found: ${dbPath}. Run pnpm test first.`);
}

process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;

const [{ prisma }, { primitiveExecutor }] = await Promise.all([
  import("../src/db/prisma.js"),
  import("../src/modules/primitive/primitive-wrapper.js")
]);

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function assertCompleteSample(row: AuditSampleRow): void {
  const missingFields: string[] = [];
  if (!row.primitive) missingFields.push("primitive");
  if (!row.mutationType) missingFields.push("mutationType");
  if (!row.status) missingFields.push("status");
  if (!row.resultJson) missingFields.push("resultJson");
  if (!row.startedAt) missingFields.push("startedAt");
  if (!row.completedAt) missingFields.push("completedAt");
  if (row.durationMs === null || row.durationMs === undefined) missingFields.push("durationMs");

  if (missingFields.length > 0) {
    throw new Error(`audit sample ${row.id} missing fields: ${missingFields.join(", ")}`);
  }
  if (row.status !== "completed") {
    throw new Error(`audit sample ${row.id} expected completed status, got ${row.status}`);
  }
}

async function main(): Promise<void> {
  const runId = `f7-c-${Date.now()}-${randomUUID()}`;
  const keyPrefix = `f7-c-audit-smoke:${runId}:`;

  for (let index = 0; index < sampleSize; index += 1) {
    await primitiveExecutor.run({
      primitive: "test_f7_c_audit_smoke",
      mutationType: "prisma.test.f7_c.audit_smoke",
      idempotencyKey: `${keyPrefix}${index}`,
      run: async () => ({
        ok: true,
        runId,
        index,
        source: "f7-c-slice-5"
      })
    });
  }

  const totalRows = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*) AS count
    FROM PrimitiveAudit
  `;
  const totalCount = toNumber(totalRows[0]?.count ?? 0);
  if (totalCount <= 0) {
    throw new Error("PrimitiveAudit is empty after F7-C smoke writes");
  }

  const sampleRows = await prisma.$queryRaw<AuditSampleRow[]>`
    SELECT id, primitive, mutationType, status, resultJson, errorJson, startedAt, completedAt, durationMs
    FROM PrimitiveAudit
    WHERE idempotencyKey LIKE ${`${keyPrefix}%`}
    ORDER BY RANDOM()
    LIMIT ${sampleSize}
  `;

  if (sampleRows.length !== sampleSize) {
    throw new Error(`expected ${sampleSize} audit sample rows, got ${sampleRows.length}`);
  }

  for (const row of sampleRows) {
    assertCompleteSample(row);
  }

  console.log("F7-C audit sample verify");
  console.log(`database: ${dbPath}`);
  console.log(`smoke_run_id: ${runId}`);
  console.log(`smoke_rows_written: ${sampleSize}`);
  console.log("SQL> SELECT COUNT(*) FROM PrimitiveAudit;");
  console.log(`count: ${totalCount}`);
  console.log(
    "SQL> SELECT id, primitive, mutationType, status, resultJson, startedAt, completedAt, durationMs FROM PrimitiveAudit WHERE idempotencyKey LIKE '<smoke_run_prefix>%' ORDER BY RANDOM() LIMIT 10;"
  );
  console.log(`sample_rows: ${sampleRows.length}`);
  console.log(`field_check: ${sampleRows.length}/${sampleSize} complete`);
  for (const row of sampleRows) {
    console.log(
      [
        `sample id=${row.id}`,
        `primitive=${row.primitive}`,
        `mutationType=${row.mutationType}`,
        `status=${row.status}`,
        `resultJsonBytes=${row.resultJson?.length ?? 0}`,
        `startedAt=${row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt}`,
        `completedAt=${row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt}`,
        `durationMs=${row.durationMs?.toString()}`
      ].join(" ")
    );
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
