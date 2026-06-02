import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { afterEach, test, vi } from "vitest";

import { prisma } from "../../db/prisma.js";
import { primitiveExecutor } from "./primitive-wrapper.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.primitiveAudit.deleteMany();
});

test("primitiveExecutor records completed audit row with serialized result", async () => {
  const idempotencyKey = `primitive-success-${randomUUID()}`;
  const result = await primitiveExecutor.run({
    primitive: "test_success_primitive",
    mutationType: "prisma.test.success",
    idempotencyKey,
    run: async () => ({ ok: true, value: 42 })
  });

  assert.deepEqual(result, { ok: true, value: 42 });

  const audit = await prisma.primitiveAudit.findUniqueOrThrow({
    where: { idempotencyKey }
  });

  assert.equal(audit.primitive, "test_success_primitive");
  assert.equal(audit.mutationType, "prisma.test.success");
  assert.equal(audit.status, "completed");
  assert.deepEqual(JSON.parse(audit.resultJson ?? "null"), { ok: true, value: 42 });
  assert.equal(audit.errorJson, null);
  assert.ok(audit.completedAt instanceof Date);
  assert.equal(typeof audit.durationMs, "number");
});

test("primitiveExecutor returns cached result for repeated idempotency key without re-running", async () => {
  const idempotencyKey = `primitive-cache-${randomUUID()}`;
  let runCount = 0;

  const first = await primitiveExecutor.run({
    primitive: "test_cache_primitive",
    mutationType: "prisma.test.cache",
    idempotencyKey,
    run: async () => {
      runCount += 1;
      return { runCount, source: "fresh" };
    }
  });
  const second = await primitiveExecutor.run({
    primitive: "test_cache_primitive",
    mutationType: "prisma.test.cache",
    idempotencyKey,
    run: async () => {
      runCount += 1;
      return { runCount, source: "unexpected" };
    }
  });

  assert.deepEqual(first, { runCount: 1, source: "fresh" });
  assert.deepEqual(second, { runCount: 1, source: "fresh" });
  assert.equal(runCount, 1);
  assert.equal(await prisma.primitiveAudit.count({ where: { idempotencyKey } }), 1);
});

test("primitiveExecutor logs audit insert failures without blocking business result", async () => {
  const idempotencyKey = `primitive-insert-fallback-${randomUUID()}`;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await prisma.primitiveAudit.create({
    data: {
      primitive: "test_existing_audit",
      mutationType: "prisma.test.existing",
      idempotencyKey,
      status: "running"
    }
  });

  const result = await primitiveExecutor.run({
    primitive: "test_insert_fallback_primitive",
    mutationType: "prisma.test.insertFallback",
    idempotencyKey,
    run: async () => ({ ok: true })
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(await prisma.primitiveAudit.count({ where: { idempotencyKey } }), 1);
  assert.equal(warnSpy.mock.calls.some((call) => call[0] === "primitive audit insert failed"), true);
});

test("primitiveExecutor coalesces concurrent calls with the same idempotency key", async () => {
  const idempotencyKey = `primitive-concurrent-${randomUUID()}`;
  let runCount = 0;
  let releaseRun!: () => void;
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });

  const firstRun = primitiveExecutor.run({
    primitive: "test_concurrent_primitive",
    mutationType: "prisma.test.concurrent",
    idempotencyKey,
    run: async () => {
      runCount += 1;
      await runGate;
      return { value: "single-run", runCount };
    }
  });
  const secondRun = primitiveExecutor.run({
    primitive: "test_concurrent_primitive",
    mutationType: "prisma.test.concurrent",
    idempotencyKey,
    run: async () => {
      runCount += 1;
      return { value: "duplicate-run", runCount };
    }
  });

  releaseRun();
  const [first, second] = await Promise.all([firstRun, secondRun]);

  assert.deepEqual(first, { value: "single-run", runCount: 1 });
  assert.deepEqual(second, { value: "single-run", runCount: 1 });
  assert.equal(runCount, 1);
  assert.equal(await prisma.primitiveAudit.count({ where: { idempotencyKey } }), 1);
});

test("primitiveExecutor truncates oversized resultJson with marker", async () => {
  const idempotencyKey = `primitive-truncate-${randomUUID()}`;
  const result = await primitiveExecutor.run({
    primitive: "test_truncate_primitive",
    mutationType: "prisma.test.truncate",
    idempotencyKey,
    run: async () => ({ payload: "x".repeat(60 * 1024) })
  });

  assert.equal(result.payload.length, 60 * 1024);
  const audit = await prisma.primitiveAudit.findUniqueOrThrow({
    where: { idempotencyKey }
  });
  const stored = JSON.parse(audit.resultJson ?? "{}") as {
    truncated?: boolean;
    originalLength?: number;
    value?: string;
  };

  assert.equal(audit.status, "completed");
  assert.ok((audit.resultJson ?? "").length <= 50 * 1024);
  assert.equal(stored.truncated, true);
  assert.equal(stored.originalLength, JSON.stringify(result).length);
  assert.match(stored.value ?? "", /^\{"payload":"x+/);
});

test("primitiveExecutor creates a new audit row for each null idempotency key run", async () => {
  let runCount = 0;

  const first = await primitiveExecutor.run({
    primitive: "test_null_idempotency_primitive",
    mutationType: "prisma.test.nullIdempotency",
    idempotencyKey: null,
    run: async () => {
      runCount += 1;
      return { runCount };
    }
  });
  const second = await primitiveExecutor.run({
    primitive: "test_null_idempotency_primitive",
    mutationType: "prisma.test.nullIdempotency",
    idempotencyKey: null,
    run: async () => {
      runCount += 1;
      return { runCount };
    }
  });

  assert.deepEqual(first, { runCount: 1 });
  assert.deepEqual(second, { runCount: 2 });
  assert.equal(runCount, 2);
  assert.equal(
    await prisma.primitiveAudit.count({
      where: {
        primitive: "test_null_idempotency_primitive",
        idempotencyKey: null
      }
    }),
    2
  );
});

test("primitiveExecutor records failed audit row with serialized error and rethrows", async () => {
  const idempotencyKey = `primitive-failure-${randomUUID()}`;
  const error = new Error("primitive boom");

  await assert.rejects(
    () =>
      primitiveExecutor.run({
        primitive: "test_failure_primitive",
        mutationType: "prisma.test.failure",
        idempotencyKey,
        run: async () => {
          throw error;
        }
      }),
    /primitive boom/
  );

  const audit = await prisma.primitiveAudit.findUniqueOrThrow({
    where: { idempotencyKey }
  });
  const errorJson = JSON.parse(audit.errorJson ?? "{}") as { message?: string; name?: string; stack?: string };

  assert.equal(audit.primitive, "test_failure_primitive");
  assert.equal(audit.mutationType, "prisma.test.failure");
  assert.equal(audit.status, "failed");
  assert.equal(audit.resultJson, null);
  assert.equal(errorJson.name, "Error");
  assert.equal(errorJson.message, "primitive boom");
  assert.match(errorJson.stack ?? "", /primitive boom/);
  assert.ok(audit.completedAt instanceof Date);
  assert.equal(typeof audit.durationMs, "number");
});
