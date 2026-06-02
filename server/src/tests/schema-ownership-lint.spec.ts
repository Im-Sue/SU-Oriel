import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, test } from "vitest";

import { runSchemaOwnershipLint } from "../maintenance/schema-ownership-lint.js";

const tempRoots: string[] = [];

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "schema-ownership-lint-"));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  return root;
}

function matrixYaml(): string {
  return [
    "schema_version: schema-ownership-matrix-v0.1",
    "entities:",
    "  - entity: Task",
    "    fields:",
    "      - field: status",
    "        owner: db-owned",
    "        sub_mode: projection-only",
    "        sync: db_to_file",
    "        write_entries: [task.routes primitive]",
    "      - field: currentNode",
    "        owner: db-owned",
    "        sub_mode: projection-only",
    "        sync: db_to_file",
    "        write_entries: [task.routes primitive]",
    "  - entity: Requirement",
    "    fields:",
    "      - field: status",
    "        owner: db-owned",
    "        sub_mode: derived",
    "        sync: none",
    "        write_entries: [requirement-status-rollup]",
    "allowed_write_entries:",
    "  - task.routes primitive",
    "  - requirement-status-rollup"
  ].join("\n");
}

function phase4MatrixYaml(): string {
  return [
    "schema_version: schema-ownership-matrix-v1",
    "entities:",
    "  - entity: Task",
    "    fields:",
    "      - field: status",
    "        owner: plugin-canonical",
    "        source: task-state",
    "        sync: file_to_db",
    "      - field: progress",
    "        owner: plugin-canonical",
    "        source: task-state",
    "        sync: file_to_db",
    "      - field: priority",
    "        owner: console-internal",
    "        source: operator",
    "        sync: none",
    "        write_entries: [task.routes primitive]",
    "allowed_write_entries:",
    "  - task.routes primitive"
  ].join("\n");
}

function schema(owner = "db-owned", subMode = "projection-only"): string {
  return [
    "model Task {",
    "  /// @owner(db-owned, db-only)",
    "  id String @id",
    `  /// @owner(${owner}, ${subMode})`,
    "  status String",
    "  /// @owner(db-owned, projection-only)",
    "  currentNode String?",
    "}",
    "",
    "model Requirement {",
    "  /// @owner(db-owned, db-only)",
    "  id String @id",
    "  /// @owner(db-owned, derived)",
    "  status String",
    "}"
  ].join("\n");
}

function phase4Schema(): string {
  return [
    "model Task {",
    "  /// @owner(console-internal, operator)",
    "  id String @id",
    "  /// @owner(plugin-canonical, task-state)",
    "  status String",
    "  /// @owner(plugin-canonical, task-state)",
    "  progress Int",
    "  /// @owner(console-internal, operator)",
    "  priority String",
    "}"
  ].join("\n");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("schema owner annotation mismatch fails check mode", async () => {
  const root = await createFixture({
    "matrix.yaml": matrixYaml(),
    "schema.prisma": schema("file-owned", "scan-sync"),
    "src/ok.ts": "export const ok = true;\n"
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.failures.some((finding) => finding.code === "schema_owner_mismatch"), true);
});

test("raw task writes fail, including spread data and tx alias", async () => {
  const root = await createFixture({
    "matrix.yaml": matrixYaml(),
    "schema.prisma": schema(),
    "src/raw.ts": [
      "export async function bad(prisma: any, data: any) {",
      "  await prisma.task.update({ where: { id: 't1' }, data: { ...data, status: 'done' } });",
      "}",
      "export async function alias(prisma: any) {",
      "  const tx = prisma;",
      "  await tx.task.update({ where: { id: 't1' }, data: { currentNode: 'archive' } });",
      "}"
    ].join("\n")
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.failures.filter((finding) => finding.code === "write_missing_primitive").length, 2);
});

test("maintenance source paths are skipped while module raw writes still fail", async () => {
  const root = await createFixture({
    "matrix.yaml": matrixYaml(),
    "schema.prisma": schema(),
    "src/maintenance/raw.ts": [
      "export async function maintenance(prisma: any) {",
      "  await prisma.task.update({ where: { id: 't1' }, data: { status: 'done' } });",
      "}"
    ].join("\n"),
    "src/modules/task/raw.ts": [
      "export async function moduleWrite(prisma: any) {",
      "  await prisma.task.update({ where: { id: 't1' }, data: { status: 'done' } });",
      "}"
    ].join("\n")
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.skippedPaths.count, 1);
  assert.deepEqual(result.skippedPaths.matched, ["maintenance/**"]);
  assert.equal(result.failures.filter((finding) => finding.code === "write_missing_primitive").length, 1);
  assert.equal(result.failures.some((finding) => finding.file?.includes("src/maintenance/raw.ts")), false);
  assert.equal(result.failures.some((finding) => finding.file?.includes("src/modules/task/raw.ts")), true);
});

test("helper-encapsulated console-internal primitive write passes", async () => {
  const root = await createFixture({
    "matrix.yaml": matrixYaml(),
    "schema.prisma": schema(),
      "src/helper.ts": [
      "import { primitiveExecutor } from './primitive-wrapper';",
      "export async function updateTaskMetadataAsync(prisma: any, taskId: string) {",
      "  return await primitiveExecutor.run({",
      "    primitive: 'update_task_metadata',",
      "    mutationType: 'prisma.task.update',",
      "    run: async () => {",
      "      return await prisma.task.update({ where: { id: taskId }, data: { priority: 'high' } });",
      "    }",
      "  });",
      "}"
    ].join("\n")
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.failures.length, 0);
});

test("primitive audit writes inside primitive wrapper are allowed without recursive primitive wrapping", async () => {
  const root = await createFixture({
    "matrix.yaml": [
      "schema_version: schema-ownership-matrix-v0.1",
      "entities:",
      "  - entity: PrimitiveAudit",
      "    fields:",
      "      - field: primitive",
      "        owner: db-owned",
      "        sub_mode: db-only",
      "        sync: none",
      "      - field: mutationType",
      "        owner: db-owned",
      "        sub_mode: db-only",
      "        sync: none",
      "      - field: idempotencyKey",
      "        owner: db-owned",
      "        sub_mode: db-only",
      "        sync: none",
      "      - field: status",
      "        owner: db-owned",
      "        sub_mode: db-only",
      "        sync: none",
      "      - field: resultJson",
      "        owner: db-owned",
      "        sub_mode: db-only",
      "        sync: none",
      "allowed_write_entries:",
      "  - primitive-audit internal"
    ].join("\n"),
    "schema.prisma": [
      "model PrimitiveAudit {",
      "  /// @owner(db-owned, db-only)",
      "  id String @id",
      "  /// @owner(db-owned, db-only)",
      "  primitive String",
      "  /// @owner(db-owned, db-only)",
      "  mutationType String",
      "  /// @owner(db-owned, db-only)",
      "  idempotencyKey String?",
      "  /// @owner(db-owned, db-only)",
      "  status String",
      "  /// @owner(db-owned, db-only)",
      "  resultJson String?",
      "}"
    ].join("\n"),
    "src/modules/primitive/primitive-wrapper.ts": [
      "export async function record(prisma: any) {",
      "  const audit = await prisma.primitiveAudit.create({",
      "    data: { primitive: 'p', mutationType: 'm', idempotencyKey: 'k', status: 'running' }",
      "  });",
      "  await prisma.primitiveAudit.update({ where: { id: audit.id }, data: { status: 'completed', resultJson: '{}' } });",
      "}"
    ].join("\n")
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.failures.length, 0);
});

test("coverage skips Prisma relation fields while keeping scalar uncovered fields", async () => {
  const root = await createFixture({
    "matrix.yaml": [
      "schema_version: schema-ownership-matrix-v0.1",
      "entities:",
      "  - entity: Task",
      "    fields:",
      "      - field: status",
      "        owner: db-owned",
      "        sub_mode: projection-only",
      "        sync: db_to_file",
      "        write_entries: [task.routes primitive]",
      "allowed_write_entries:",
      "  - task.routes primitive"
    ].join("\n"),
    "schema.prisma": [
      "model Project {",
      "  /// @owner(db-owned, db-only)",
      "  id String @id",
      "  tasks Task[]",
      "}",
      "",
      "model Task {",
      "  /// @owner(db-owned, db-only)",
      "  id String @id",
      "  /// @owner(db-owned, projection-only)",
      "  status String",
      "  /// @owner(db-owned, db-only)",
      "  projectId String",
      "  project Project @relation(fields: [projectId], references: [id])",
      "}"
    ].join("\n"),
    "src/ok.ts": "export const ok = true;\n"
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(
    result.coverage.uncoveredFields.some((field) => field.entity === "Task" && field.field === "project"),
    false
  );
  assert.equal(
    result.coverage.uncoveredFields.some((field) => field.entity === "Task" && field.field === "projectId"),
    true
  );
});

test("phase4 schema fields missing owner annotation fail even before coverage warnings", async () => {
  const root = await createFixture({
    "matrix.yaml": phase4MatrixYaml(),
    "schema.prisma": [
      "model Task {",
      "  id String @id",
      "  /// @owner(plugin-canonical, task-state)",
      "  status String",
      "  progress Int",
      "}"
    ].join("\n"),
    "src/ok.ts": "export const ok = true;\n"
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.failures.some((finding) => finding.code === "schema_owner_missing"), true);
});

test("phase4 console route writes to plugin-canonical fields fail", async () => {
  const root = await createFixture({
    "matrix.yaml": phase4MatrixYaml(),
    "schema.prisma": phase4Schema(),
    "src/modules/task/task.routes.ts": [
      "import { primitiveExecutor } from '../../primitive/primitive-wrapper';",
      "export async function bad(prisma: any, taskId: string) {",
      "  return await primitiveExecutor.run({",
      "    primitive: 'update_task_metadata',",
      "    mutationType: 'prisma.task.update',",
      "    run: async () => {",
      "      return await prisma.task.update({ where: { id: taskId }, data: { status: 'done' } });",
      "    }",
      "  });",
      "}"
    ].join("\n")
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.failures.some((finding) => finding.code === "write_plugin_canonical_from_console_route"), true);
});

test("phase5 requirement rollup may write rollup fields but not Requirement.status", async () => {
  const root = await createFixture({
    "matrix.yaml": [
      "schema_version: schema-ownership-matrix-v1",
      "entities:",
      "  - entity: Requirement",
      "    fields:",
      "      - field: status",
      "        owner: plugin-canonical",
      "        source: requirement-md",
      "        sync: file_to_db",
      "      - field: rollupStatus",
      "        owner: plugin-canonical",
      "        source: requirement-md",
      "        sync: file_to_db",
      "        write_entries: [requirement-status-rollup]",
      "      - field: rollupProgress",
      "        owner: plugin-canonical",
      "        source: requirement-md",
      "        sync: file_to_db",
      "        write_entries: [requirement-status-rollup]",
      "allowed_write_entries:",
      "  - requirement-status-rollup"
    ].join("\n"),
    "schema.prisma": [
      "model Requirement {",
      "  /// @owner(console-internal, operator)",
      "  id String @id",
      "  /// @owner(plugin-canonical, requirement-md)",
      "  status String",
      "  /// @owner(plugin-canonical, requirement-md)",
      "  rollupStatus String?",
      "  /// @owner(plugin-canonical, requirement-md)",
      "  rollupProgress Int",
      "}"
    ].join("\n"),
    "src/modules/requirement/requirement-status-rollup.ts": [
      "import { primitiveExecutor } from '../primitive/primitive-wrapper';",
      "export async function ok(client: any, id: string) {",
      "  return await primitiveExecutor.run({",
      "    primitive: 'rollup_requirement_status',",
      "    mutationType: 'prisma.requirement.update',",
      "    run: async () => client.requirement.update({",
      "      where: { id },",
      "      data: { rollupStatus: 'delivered', rollupProgress: 100 }",
      "    })",
      "  });",
      "}",
      "export async function bad(client: any, id: string) {",
      "  return await primitiveExecutor.run({",
      "    primitive: 'rollup_requirement_status',",
      "    mutationType: 'prisma.requirement.update',",
      "    run: async () => client.requirement.update({",
      "      where: { id },",
      "      data: { status: 'delivered' }",
      "    })",
      "  });",
      "}"
    ].join("\n")
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.failures.some((finding) => finding.code === "write_requirement_status_from_rollup"), true);
});

test("phase5 requirement reanalyze Console fallback writes fail lint", async () => {
  const root = await createFixture({
    "matrix.yaml": [
      "schema_version: schema-ownership-matrix-v1",
      "entities:",
      "  - entity: Requirement",
      "    fields:",
      "      - field: id",
      "        owner: console-internal",
      "        source: operator",
      "        sync: none",
      "allowed_write_entries: []"
    ].join("\n"),
    "schema.prisma": [
      "model Requirement {",
      "  /// @owner(console-internal, operator)",
      "  id String @id",
      "}"
    ].join("\n"),
    "src/modules/requirement/requirement-reanalyze.service.ts": [
      "import { writeFile } from 'node:fs/promises';",
      "import { syncRequirementsFromMarkdown } from '../../indexer/project-indexer';",
      "export async function runMockReanalyze(path: string) {",
      "  await writeFile(path, 'content', 'utf8');",
      "  await syncRequirementsFromMarkdown();",
      "}"
    ].join("\n")
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "src")],
    mode: "check"
  });

  assert.equal(result.failures.some((finding) => finding.code === "reanalyze_console_writefile_forbidden"), true);
  assert.equal(result.failures.some((finding) => finding.code === "reanalyze_console_sync_fallback_forbidden"), true);
});

test("phase4 plugin lib writes to console-internal fields fail", async () => {
  const root = await createFixture({
    "matrix.yaml": phase4MatrixYaml(),
    "schema.prisma": phase4Schema(),
    "plugin/lib/bad.mjs": [
      "export async function bad(prisma, taskId) {",
      "  await prisma.task.update({ where: { id: taskId }, data: { priority: 'urgent' } });",
      "}"
    ].join("\n")
  });

  const result = await runSchemaOwnershipLint({
    matrixPath: join(root, "matrix.yaml"),
    schemaPath: join(root, "schema.prisma"),
    sourceRoots: [join(root, "plugin/lib")],
    mode: "check"
  });

  assert.equal(result.failures.some((finding) => finding.code === "write_console_internal_from_plugin_lib"), true);
});
