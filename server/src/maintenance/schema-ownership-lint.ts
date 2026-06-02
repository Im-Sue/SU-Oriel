import { readdir, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  CallExpression,
  Node,
  ObjectLiteralExpression,
  Project,
  PropertyAccessExpression,
  SyntaxKind
} from "ts-morph";

export type LintMode = "check" | "report";
export type Severity = "failure" | "warning";

export interface LintFinding {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
  line?: number;
}

interface MatrixField {
  field: string;
  owner: string;
  subMode: string;
  sync: string | null;
  writeEntries: string[];
}

interface MatrixEntity {
  entity: string;
  fields: Map<string, MatrixField>;
}

interface OwnershipMatrix {
  entities: Map<string, MatrixEntity>;
  allowedWriteEntries: Set<string>;
}

interface SchemaField {
  name: string;
  type: string;
  line: number;
  hasRelationDirective: boolean;
  owner?: {
    owner: string;
    subMode: string;
  };
}

interface SchemaModel {
  name: string;
  fields: Map<string, SchemaField>;
}

interface PrismaSchema {
  models: Map<string, SchemaModel>;
}

interface WriteCall {
  call: CallExpression;
  filePath: string;
  entity: string;
  delegate: string;
  method: string;
  dataFields: Set<string>;
  hasSpread: boolean;
}

export interface SchemaOwnershipLintOptions {
  matrixPath: string;
  schemaPath: string;
  sourceRoots: string[];
  mode: LintMode;
}

export interface SchemaOwnershipLintResult {
  failures: LintFinding[];
  warnings: LintFinding[];
  skippedPaths: {
    count: number;
    matched: string[];
  };
  coverage: {
    uncoveredEntities: string[];
    uncoveredFields: Array<{ entity: string; field: string }>;
    matrixFieldsMissingInSchema: Array<{ entity: string; field: string }>;
  };
}

const OWNER_PATTERN = /^\/\/\/\s*@owner\(([^,\s]+)\s*,\s*([^)]+)\)\s*$/;
const WRITE_METHOD_PATTERN = /^(create|createMany|update|updateMany|upsert)/;
const DEFAULT_SOURCE_EXCLUDES = [`${sep}tests${sep}`, `${sep}scripts${sep}`];
const EXEMPT_PATH_PATTERNS = ["**/maintenance/**"] as const;
const PLUGIN_CANONICAL_OWNER = "plugin-canonical";
const CONSOLE_INTERNAL_OWNER = "console-internal";

export async function runSchemaOwnershipLint(
  options: SchemaOwnershipLintOptions
): Promise<SchemaOwnershipLintResult> {
  const matrix = parseMatrix(await readFile(options.matrixPath, "utf8"));
  const schema = parsePrismaSchema(await readFile(options.schemaPath, "utf8"));
  const failures: LintFinding[] = [];
  const warnings: LintFinding[] = [];

  const coverage = compareSchemaOwnership(matrix, schema, options.schemaPath, failures, warnings);
  const sourceFiles = await collectSourceFiles(options.sourceRoots);
  const writeFindings = scanTypeScriptWrites(matrix, sourceFiles.files);
  failures.push(...writeFindings.filter((finding) => finding.severity === "failure"));
  warnings.push(...writeFindings.filter((finding) => finding.severity === "warning"));

  return { failures, warnings, skippedPaths: sourceFiles.skippedPaths, coverage };
}

export function formatSchemaOwnershipReport(result: SchemaOwnershipLintResult): string {
  const lines: string[] = [];
  lines.push("section 1: schema annotations vs matrix");
  appendFindings(lines, result.failures.filter((finding) => finding.code.startsWith("schema_")));
  appendFindings(lines, result.warnings.filter((finding) => finding.code.startsWith("schema_")));
  lines.push("");
  lines.push("section 2: write entry violations");
  appendFindings(lines, result.failures.filter((finding) => finding.code.startsWith("write_")));
  appendFindings(lines, result.warnings.filter((finding) => finding.code.startsWith("write_")));
  lines.push("");
  lines.push("section 3: coverage");
  lines.push(`uncovered entities: ${result.coverage.uncoveredEntities.join(", ") || "none"}`);
  lines.push(
    `covered entity fields missing from matrix: ${
      result.coverage.uncoveredFields.map((item) => `${item.entity}.${item.field}`).join(", ") || "none"
    }`
  );
  lines.push(
    `matrix fields missing from schema: ${
      result.coverage.matrixFieldsMissingInSchema.map((item) => `${item.entity}.${item.field}`).join(", ") || "none"
    }`
  );
  lines.push("");
  lines.push(
    `skipped paths: ${result.skippedPaths.count} (matched: ${result.skippedPaths.matched.join(", ") || "none"})`
  );
  lines.push(`summary: ${result.failures.length} failure(s), ${result.warnings.length} warning(s)`);
  return lines.join("\n");
}

function appendFindings(lines: string[], findings: LintFinding[]): void {
  if (findings.length === 0) {
    lines.push("  none");
    return;
  }
  for (const finding of findings) {
    const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}: ` : "";
    lines.push(`  [${finding.severity}] ${location}${finding.code}: ${finding.message}`);
  }
}

function parseMatrix(content: string): OwnershipMatrix {
  const entities = new Map<string, MatrixEntity>();
  const allowedWriteEntries = new Set<string>();
  let currentEntity: MatrixEntity | null = null;
  let currentField: MatrixField | null = null;
  let inAllowedWriteEntries = false;

  for (const line of content.split(/\r?\n/)) {
    const entityMatch = line.match(/^  - entity:\s*([A-Za-z0-9_]+)\s*$/);
    if (entityMatch) {
      currentEntity = { entity: entityMatch[1], fields: new Map() };
      entities.set(currentEntity.entity, currentEntity);
      currentField = null;
      inAllowedWriteEntries = false;
      continue;
    }

    if (line.match(/^allowed_write_entries:\s*$/)) {
      inAllowedWriteEntries = true;
      currentEntity = null;
      currentField = null;
      continue;
    }

    if (inAllowedWriteEntries) {
      const itemMatch = line.match(/^\s*-\s*(.+?)\s*(?:#.*)?$/);
      if (itemMatch) {
        allowedWriteEntries.add(itemMatch[1].trim());
        continue;
      }
      if (line.trim() && !line.startsWith(" ")) {
        inAllowedWriteEntries = false;
      }
    }

    const fieldMatch = line.match(/^      - field:\s*([A-Za-z0-9_]+)\s*$/);
    if (fieldMatch && currentEntity) {
      currentField = {
        field: fieldMatch[1],
        owner: "",
        subMode: "",
        sync: null,
        writeEntries: []
      };
      currentEntity.fields.set(currentField.field, currentField);
      continue;
    }

    if (!currentField) {
      continue;
    }

    const ownerMatch = line.match(/^        owner:\s*(\S+)\s*$/);
    if (ownerMatch) {
      currentField.owner = ownerMatch[1];
      continue;
    }
    const subModeMatch = line.match(/^        (?:sub_mode|source):\s*(\S+)\s*$/);
    if (subModeMatch) {
      currentField.subMode = subModeMatch[1];
      continue;
    }
    const syncMatch = line.match(/^        sync:\s*(\S+)\s*$/);
    if (syncMatch) {
      currentField.sync = syncMatch[1];
      continue;
    }
    const entriesMatch = line.match(/^        write_entries:\s*\[(.*)]\s*$/);
    if (entriesMatch) {
      currentField.writeEntries = entriesMatch[1]
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }

  return { entities, allowedWriteEntries };
}

function parsePrismaSchema(content: string): PrismaSchema {
  const models = new Map<string, SchemaModel>();
  const pendingOwnerComments: Array<{ owner: string; subMode: string }> = [];
  let currentModel: SchemaModel | null = null;

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const modelMatch = line.match(/^model\s+([A-Za-z0-9_]+)\s*\{/);
    if (modelMatch) {
      currentModel = { name: modelMatch[1], fields: new Map() };
      models.set(currentModel.name, currentModel);
      pendingOwnerComments.length = 0;
      continue;
    }
    if (!currentModel) {
      continue;
    }
    if (line.match(/^}/)) {
      currentModel = null;
      pendingOwnerComments.length = 0;
      continue;
    }

    const ownerMatch = line.trim().match(OWNER_PATTERN);
    if (ownerMatch) {
      pendingOwnerComments.push({ owner: ownerMatch[1], subMode: ownerMatch[2].trim() });
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      if (!trimmed.startsWith("///")) {
        pendingOwnerComments.length = 0;
      }
      continue;
    }
    if (trimmed.startsWith("@@")) {
      pendingOwnerComments.length = 0;
      continue;
    }

    const fieldMatch = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*(?:\?|\[\])?)/);
    if (fieldMatch) {
      const owner = pendingOwnerComments[pendingOwnerComments.length - 1];
      currentModel.fields.set(fieldMatch[1], {
        name: fieldMatch[1],
        type: fieldMatch[2],
        line: index + 1,
        hasRelationDirective: line.includes("@relation"),
        owner
      });
    }
    pendingOwnerComments.length = 0;
  }

  return { models };
}

function compareSchemaOwnership(
  matrix: OwnershipMatrix,
  schema: PrismaSchema,
  schemaPath: string,
  failures: LintFinding[],
  warnings: LintFinding[]
): SchemaOwnershipLintResult["coverage"] {
  const coverage: SchemaOwnershipLintResult["coverage"] = {
    uncoveredEntities: [],
    uncoveredFields: [],
    matrixFieldsMissingInSchema: []
  };

  for (const [entity, model] of schema.models) {
    const matrixEntity = matrix.entities.get(entity);
    if (!matrixEntity) {
      coverage.uncoveredEntities.push(entity);
      for (const schemaField of model.fields.values()) {
        if (!isRelationField(schemaField, schema) && !schemaField.owner) {
          failures.push({
            severity: "failure",
            code: "schema_owner_missing",
            message: `${entity}.${schemaField.name} missing /// @owner(...)`,
            file: schemaPath,
            line: schemaField.line
          });
        }
      }
      continue;
    }

    for (const [fieldName, schemaField] of model.fields) {
      if (isRelationField(schemaField, schema)) {
        continue;
      }
      if (!schemaField.owner) {
        const expected = matrixEntity.fields.get(fieldName);
        failures.push({
          severity: "failure",
          code: "schema_owner_missing",
          message: expected
            ? `${entity}.${fieldName} missing /// @owner(${expected.owner}, ${expected.subMode})`
            : `${entity}.${fieldName} missing /// @owner(...)`,
          file: schemaPath,
          line: schemaField.line
        });
        continue;
      }
      const matrixField = matrixEntity.fields.get(fieldName);
      if (!matrixField) {
        coverage.uncoveredFields.push({ entity, field: fieldName });
        continue;
      }
      if (schemaField.owner.owner !== matrixField.owner || schemaField.owner.subMode !== matrixField.subMode) {
        failures.push({
          severity: "failure",
          code: "schema_owner_mismatch",
          message: `${entity}.${fieldName} schema has ${schemaField.owner.owner}, ${schemaField.owner.subMode}; matrix has ${matrixField.owner}, ${matrixField.subMode}`,
          file: schemaPath,
          line: schemaField.line
        });
      }
    }

    for (const fieldName of matrixEntity.fields.keys()) {
      if (!model.fields.has(fieldName)) {
        coverage.matrixFieldsMissingInSchema.push({ entity, field: fieldName });
        warnings.push({
          severity: "warning",
          code: "schema_matrix_field_missing",
          message: `${entity}.${fieldName} exists in matrix but not in prisma schema`,
          file: schemaPath
        });
      }
    }
  }

  return coverage;
}

function isRelationField(field: SchemaField, schema: PrismaSchema): boolean {
  const baseType = field.type.replace(/\?$/, "").replace(/\[\]$/, "");
  return schema.models.has(baseType) || field.hasRelationDirective;
}

async function collectSourceFiles(roots: string[]): Promise<{
  files: string[];
  skippedPaths: SchemaOwnershipLintResult["skippedPaths"];
}> {
  const files: string[] = [];
  const skippedPathPatterns = new Set<string>();
  let skippedPathCount = 0;
  for (const root of roots) {
    skippedPathCount += await collect(root, files, skippedPathPatterns);
  }
  return {
    files: files.sort(),
    skippedPaths: {
      count: skippedPathCount,
      matched: [...skippedPathPatterns].sort()
    }
  };
}

async function collect(path: string, files: string[], skippedPathPatterns: Set<string>): Promise<number> {
  let skippedPathCount = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      skippedPathCount += await collect(child, files, skippedPathPatterns);
      continue;
    }
    if (!entry.isFile() || !/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      continue;
    }
    if (/\.(?:spec|test)\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      continue;
    }
    if (DEFAULT_SOURCE_EXCLUDES.some((segment) => child.includes(segment))) {
      continue;
    }
    const exemptPattern = matchingExemptPathPattern(child);
    if (exemptPattern) {
      skippedPathPatterns.add(formatExemptPathPattern(exemptPattern));
      skippedPathCount += 1;
      continue;
    }
    files.push(child);
  }
  return skippedPathCount;
}

function matchingExemptPathPattern(path: string): (typeof EXEMPT_PATH_PATTERNS)[number] | null {
  const normalizedPath = path.replace(/\\/g, "/");
  for (const pattern of EXEMPT_PATH_PATTERNS) {
    if (pattern === "**/maintenance/**" && normalizedPath.includes("/maintenance/")) {
      return pattern;
    }
  }
  return null;
}

function formatExemptPathPattern(pattern: (typeof EXEMPT_PATH_PATTERNS)[number]): string {
  return pattern.replace(/^\*\*\//, "");
}

function scanTypeScriptWrites(matrix: OwnershipMatrix, filePaths: string[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFiles = filePaths.map((filePath) => project.addSourceFileAtPath(filePath));

  for (const sourceFile of sourceFiles) {
    findings.push(...scanForbiddenConsoleSource(sourceFile));
    const aliases = collectPrismaClientAliases(sourceFile);
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const write = parseWriteCall(call, aliases, sourceFile.getFilePath());
      if (!write) {
        continue;
      }

      const matrixEntity = matrix.entities.get(write.entity);
      if (!matrixEntity) {
        findings.push({
          severity: "warning",
          code: "write_uncovered_entity",
          message: `${write.entity} write is outside current matrix coverage`,
          file: write.filePath,
          line: write.call.getStartLineNumber()
        });
        continue;
      }

      const touchedFields = resolveTouchedMatrixFields(write, matrixEntity);
      if (touchedFields.length === 0 && !write.hasSpread) {
        continue;
      }

      const primitive = enclosingPrimitiveRun(call);
      const primitiveName = primitive ? primitiveNameFromRun(primitive) : null;
      const entry = classifyWriteEntry(write, touchedFields, primitiveName);
      if (entry && matrix.allowedWriteEntries.size > 0 && !matrix.allowedWriteEntries.has(entry)) {
        findings.push({
          severity: "failure",
          code: "write_entry_not_allowed",
          message: `${write.entity}.${write.method} classified as '${entry}', which is not in allowed_write_entries`,
          file: write.filePath,
          line: write.call.getStartLineNumber()
        });
      }

      const ownerBoundaryFinding = checkOwnerBoundary(write, touchedFields, entry);
      if (ownerBoundaryFinding) {
        findings.push(ownerBoundaryFinding);
      }

      if (!primitive && !isPrimitiveOptionalEntry(entry, touchedFields, write)) {
        findings.push({
          severity: "failure",
          code: "write_missing_primitive",
          message: `${write.entity}.${write.method} touching ${formatFields(touchedFields, write.hasSpread)} is not wrapped in primitiveExecutor.run`,
          file: write.filePath,
          line: write.call.getStartLineNumber()
        });
      }

    }
  }

  return findings;
}

function scanForbiddenConsoleSource(sourceFile: ReturnType<Project["addSourceFileAtPath"]>): LintFinding[] {
  const findings: LintFinding[] = [];
  const normalizedPath = sourceFile.getFilePath().replace(/\\/g, "/");
  if (!normalizedPath.endsWith("/src/modules/requirement/requirement-reanalyze.service.ts")) {
    return findings;
  }

  const text = sourceFile.getFullText();
  if (/\bwriteFile\s*\(/.test(text)) {
    findings.push({
      severity: "failure",
      code: "reanalyze_console_writefile_forbidden",
      message: "requirement reanalyze fallback must not write requirement markdown from Console",
      file: sourceFile.getFilePath()
    });
  }
  if (/\bsyncRequirementsFromMarkdown\b/.test(text)) {
    findings.push({
      severity: "failure",
      code: "reanalyze_console_sync_fallback_forbidden",
      message: "requirement reanalyze fallback must not sync requirement markdown from Console",
      file: sourceFile.getFilePath()
    });
  }
  return findings;
}

function checkOwnerBoundary(write: WriteCall, fields: MatrixField[], entry: string | null): LintFinding | null {
  const normalizedPath = write.filePath.replace(/\\/g, "/");
  if (
    entry === "requirement-status-rollup" &&
    write.entity === "Requirement" &&
    fields.some((field) => field.field === "status")
  ) {
    return {
      severity: "failure",
      code: "write_requirement_status_from_rollup",
      message: "requirement-status-rollup may only write rollupStatus/rollupProgress, not Requirement.status",
      file: write.filePath,
      line: write.call.getStartLineNumber()
    };
  }

  const routeHandlerWritesPluginCanonical =
    normalizedPath.includes("/src/modules/") && normalizedPath.endsWith(".routes.ts");
  if (routeHandlerWritesPluginCanonical) {
    const blocked = fields.filter(
      (field) =>
        field.owner === PLUGIN_CANONICAL_OWNER &&
        !(entry && field.writeEntries.includes(entry)) &&
        !write.hasSpread
    );
    if (blocked.length > 0) {
      return {
        severity: "failure",
        code: "write_plugin_canonical_from_console_route",
        message: `${write.entity}.${write.method} in Console route touches plugin-canonical field(s): ${blocked
          .map((field) => field.field)
          .join(", ")}`,
        file: write.filePath,
        line: write.call.getStartLineNumber()
      };
    }
  }

  if (normalizedPath.includes("/su-ccb-claude-plugin/lib/") || normalizedPath.includes("/plugin/lib/")) {
    const blocked = fields.filter((field) => field.owner === CONSOLE_INTERNAL_OWNER);
    if (blocked.length > 0) {
      return {
        severity: "failure",
        code: "write_console_internal_from_plugin_lib",
        message: `${write.entity}.${write.method} in plugin lib touches console-internal field(s): ${blocked
          .map((field) => field.field)
          .join(", ")}`,
        file: write.filePath,
        line: write.call.getStartLineNumber()
      };
    }
  }

  return null;
}

function collectPrismaClientAliases(sourceFile: ReturnType<Project["addSourceFileAtPath"]>): Set<string> {
  const aliases = new Set(["prisma", "tx", "client"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const name = declaration.getName();
      const initializer = declaration.getInitializer();
      if (initializer && Node.isIdentifier(initializer) && aliases.has(initializer.getText()) && !aliases.has(name)) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  return aliases;
}

function parseWriteCall(call: CallExpression, aliases: Set<string>, filePath: string): WriteCall | null {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) {
    return null;
  }
  const method = expression.getName();
  if (!WRITE_METHOD_PATTERN.test(method)) {
    return null;
  }
  const delegateAccess = expression.getExpression();
  if (!Node.isPropertyAccessExpression(delegateAccess)) {
    return null;
  }
  const delegate = delegateAccess.getName();
  const clientExpression = delegateAccess.getExpression();
  if (!isKnownPrismaClientExpression(clientExpression, aliases)) {
    return null;
  }
  const args = call.getArguments();
  const data = args.length > 0 && Node.isObjectLiteralExpression(args[0]) ? collectDataFields(args[0], method) : { fields: new Set<string>(), hasSpread: true };
  return {
    call,
    filePath,
    entity: delegateToEntity(delegate),
    delegate,
    method,
    dataFields: data.fields,
    hasSpread: data.hasSpread
  };
}

function isKnownPrismaClientExpression(expression: Node, aliases: Set<string>): boolean {
  if (Node.isIdentifier(expression)) {
    return aliases.has(expression.getText());
  }
  if (Node.isPropertyAccessExpression(expression)) {
    const text = expression.getText();
    return text === "this.db" || text.endsWith(".prisma");
  }
  return false;
}

function delegateToEntity(delegate: string): string {
  return delegate
    .split(/(?=[A-Z])/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function collectDataFields(input: ObjectLiteralExpression, method: string): { fields: Set<string>; hasSpread: boolean } {
  const fields = new Set<string>();
  let hasSpread = false;
  const relevantNames = method.startsWith("upsert") ? ["create", "update"] : ["data"];

  for (const name of relevantNames) {
    const property = input.getProperty(name);
    if (!property || !Node.isPropertyAssignment(property)) {
      continue;
    }
    const initializer = property.getInitializer();
    if (!initializer || !Node.isObjectLiteralExpression(initializer)) {
      hasSpread = true;
      continue;
    }
    const collected = collectObjectFieldNames(initializer);
    for (const field of collected.fields) {
      fields.add(field);
    }
    hasSpread = hasSpread || collected.hasSpread;
  }

  return { fields, hasSpread };
}

function collectObjectFieldNames(objectLiteral: ObjectLiteralExpression): { fields: Set<string>; hasSpread: boolean } {
  const fields = new Set<string>();
  let hasSpread = false;
  for (const property of objectLiteral.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      hasSpread = true;
      continue;
    }
    if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) {
      const nameNode = property.getNameNode();
      fields.add(nameNode.getText().replace(/^["']|["']$/g, ""));
    }
  }
  return { fields, hasSpread };
}

function resolveTouchedMatrixFields(write: WriteCall, matrixEntity: MatrixEntity): MatrixField[] {
  if (write.hasSpread) {
    return [...matrixEntity.fields.values()];
  }
  return [...write.dataFields].flatMap((field) => {
    const matrixField = matrixEntity.fields.get(field);
    return matrixField ? [matrixField] : [];
  });
}

function classifyWriteEntry(write: WriteCall, fields: MatrixField[], primitiveName: string | null): string | null {
  const normalizedPath = write.filePath.replace(/\\/g, "/");
  if (write.entity === "PrimitiveAudit" && normalizedPath.endsWith("/src/modules/primitive/primitive-wrapper.ts")) {
    return "primitive-audit internal";
  }
  if (normalizedPath.endsWith("/src/indexer/project-indexer.ts")) {
    if (write.entity === "Document") return "scanProject create-only";
    if (hasAncestorFunctionNamed(write.call, "syncRequirementsFromMarkdown")) return "scanProject syncRequirementsFromMarkdown";
    if (hasAncestorFunctionNamed(write.call, "generateTaskFromRequirement") || hasAncestorFunctionNamed(write.call, "materializeRequirementTaskAsync")) {
      return "generateTaskFromRequirement";
    }
    if (hasAncestorFunctionNamed(write.call, "upsertTaskProjectionAsync")) return "state-projection refresh";
    if (hasAncestorFunctionNamed(write.call, "syncBreakdownDraftsFromFiles")) return "state-projection refresh";
    if (primitiveName === "merge_task_identity_assignment") return "state-projection refresh";
    return "createRequirementMdFirst";
  }
  if (normalizedPath.includes("/modules/requirement/requirement-status-rollup.ts")) return "requirement-status-rollup";
  if (normalizedPath.includes("/modules/task/task.routes.ts")) return "task.routes primitive";
  if (normalizedPath.includes("/modules/breakdown-draft/breakdown-draft.service.ts")) return "breakdown-draft legacy projection";
  if (normalizedPath.includes("/modules/breakdown-draft/materialize.service.ts")) return "materialize.service primitive";
  if (
    normalizedPath.includes("/modules/task/epic-status-rollup.ts") ||
    normalizedPath.includes("/modules/scheduler/handlers/epic-lifecycle.handler.ts")
  ) {
    return "epic-status-rollup primitive";
  }
  if (normalizedPath.includes("/modules/task/state-projection.ts")) return "state-projection refresh";
  if (fields.every((field) => field.owner === "file-owned")) return "scanProject syncRequirementsFromMarkdown";
  return null;
}

function hasAncestorFunctionNamed(node: Node, name: string): boolean {
  return node.getAncestors().some((ancestor) => {
    if (Node.isFunctionDeclaration(ancestor) || Node.isFunctionExpression(ancestor)) {
      return ancestor.getName() === name;
    }
    if (Node.isArrowFunction(ancestor)) {
      const parent = ancestor.getParent();
      return Node.isVariableDeclaration(parent) && parent.getName() === name;
    }
    return false;
  });
}

function enclosingPrimitiveRun(node: Node): CallExpression | null {
  for (const ancestor of node.getAncestors()) {
    if (!Node.isCallExpression(ancestor)) continue;
    const expression = ancestor.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    if (expression.getName() === "run" && expression.getExpression().getText() === "primitiveExecutor") {
      return ancestor;
    }
  }
  return null;
}

function primitiveNameFromRun(call: CallExpression): string | null {
  const firstArg = call.getArguments()[0];
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) return null;
  const primitiveProperty = firstArg.getProperty("primitive");
  if (!primitiveProperty || !Node.isPropertyAssignment(primitiveProperty)) return null;
  const initializer = primitiveProperty.getInitializer();
  if (!initializer) return null;
  if (Node.isStringLiteral(initializer)) return initializer.getLiteralText();
  return null;
}

function isPrimitiveOptionalEntry(entry: string | null, fields: MatrixField[], write: WriteCall): boolean {
  if (entry?.startsWith("scanProject")) return true;
  if (entry === "primitive-audit internal") return true;
  if (entry === "state-projection refresh") return true;
  if (entry === "breakdown-draft legacy projection") return true;
  if (entry === "generateTaskFromRequirement" && write.entity === "Requirement") return true;
  if (
    fields.length > 0 &&
    fields.every((field) => field.owner === "console-internal" || field.owner === "console-projection")
  ) {
    return true;
  }
  return fields.length > 0 && fields.every((field) => field.owner === "file-owned");
}

function formatFields(fields: MatrixField[], hasSpread: boolean): string {
  const names = fields.map((field) => field.field);
  return hasSpread ? `${names.join(", ") || "unknown"} via spread` : names.join(", ");
}
