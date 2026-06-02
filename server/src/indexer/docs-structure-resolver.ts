import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const DOCS_STRUCTURE_CONTRACT_VERSION = "docs-structure-contract-v0.1";
// bundled fallback：su-oriel 内置契约（非平级 plugin），保证 R3（无 sibling plugin）下仍可解析。
// 解析优先级仍为：显式 CCB_DOCS_STRUCTURE_CONTRACT → <projectRoot>/docs/.ccb/docs-structure-contract.yaml → 本 fallback。
export const DEFAULT_CONTRACT_PATH = join(moduleDir, "default-docs-structure-contract.yaml");

interface ContractEntry {
  path: string;
  doc_type?: string;
  doc_types?: string[];
  template?: string;
  templates?: string[];
  naming?: string;
  maintained_by?: string;
  split_by_part?: boolean;
}

interface DocumentGroup {
  doc_types?: string[];
  must_have?: string[];
  status?: string;
  follows?: string;
}

interface StatusDefinition {
  doc_types?: string[];
  kind?: string;
  fields?: string[];
  values?: string[] | Record<string, string[]>;
  source?: string;
}

interface DocsStructureContract {
  version?: string;
  human_docs?: {
    root?: string;
    naming_default?: string;
    entries?: ContractEntry[];
    view_split?: {
      reference_views?: string[];
      integrated_views?: string[];
    };
  };
  machine_layer?: {
    root?: string;
    holds?: string[];
  };
  documents?: Record<string, DocumentGroup | string[]>;
  entity_status?: Record<string, StatusDefinition>;
}

export interface ResolvedDocType {
  docType: string;
  directory: string;
  artifactPath: string;
  outputPathPattern: string;
  namingRule: string;
  template: string | null;
  templates: string[];
  maintainedBy: string | null;
  splitByPart: boolean;
  viewKind: "reference" | "integrated" | null;
  hasStatus: boolean;
  statusKind: string | null;
  statusFields: string[];
  statusValues: string[] | Record<string, string[]> | null;
  statusSource: string | null;
  documentGroup: string | null;
  requiredFrontmatter: string[];
  followsEntity: string | null;
  documentStatusRule: string | null;
}

export class DocsStructureContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsStructureContractError";
  }
}

export class UnknownDocTypeError extends Error {
  constructor(
    public readonly docType: string,
    public readonly availableDocTypes: string[]
  ) {
    super(`unknown doc_type: ${docType}`);
    this.name = "UnknownDocTypeError";
  }
}

export type MachineLayerPathKey =
  | "breakdownDrafts"
  | "eventJournal"
  | "documentMapIndex"
  | "assets"
  | "uploads"
  | "requirements"
  | "specs"
  | "templates";

export interface DocsStructureResolver {
  contract: DocsStructureContract;
  availableDocTypes: string[];
  humanDocsRoot: string;
  machineLayerRoot: string;
  resolveDocType(docType: string): ResolvedDocType;
  resolveMachineLayerPath(key: MachineLayerPathKey): string;
  inferDocTypesForPath(relativePath: string): string[];
  isHumanDocsPath(relativePath: string): boolean;
  shouldIgnoreMachineLayerScanPath(relativePath: string): boolean;
}

const cachedResolvers = new Map<string, { mtimeMs: number; resolver: DocsStructureResolver }>();

const MACHINE_LAYER_PATHS: Record<MachineLayerPathKey, string> = {
  breakdownDrafts: "drafts/breakdown/",
  eventJournal: "events/journal.jsonl",
  documentMapIndex: "index/document-map.json",
  assets: "assets/",
  uploads: "uploads/",
  requirements: "requirements/",
  specs: "specs/",
  templates: "templates/"
};

const MACHINE_LAYER_SCAN_IGNORED_KEYS: MachineLayerPathKey[] = [
  "assets",
  "uploads",
  "requirements",
  "specs",
  "templates"
];

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === "#" && !quote) return line.slice(0, index);
  }
  return line;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    return body ? body.split(",").map((item) => parseScalar(item.trim())) : [];
  }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function splitKeyValue(text: string): [string, string] | null {
  const index = text.indexOf(":");
  if (index === -1) return null;
  return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
}

function parseYamlSubset(text: string): DocsStructureContract {
  const lines = text
    .replace(/\t/g, "  ")
    .split(/\r?\n/)
    .map((raw) => {
      const line = stripComment(raw).replace(/\s+$/g, "");
      return { indent: line.match(/^ */)?.[0].length ?? 0, text: line.trim() };
    })
    .filter((line) => line.text.length > 0);
  const state = { index: 0 };

  function parseBlock(indent: number): unknown {
    const line = lines[state.index];
    if (!line || line.indent < indent) return null;
    return line.text.startsWith("- ") ? parseSequence(line.indent) : parseMapping(line.indent);
  }

  function parseSequence(indent: number): unknown[] {
    const items: unknown[] = [];
    while (state.index < lines.length) {
      const line = lines[state.index];
      if (line.indent !== indent || !line.text.startsWith("- ")) break;
      const itemText = line.text.slice(2).trim();
      state.index += 1;

      if (!itemText) {
        items.push(parseBlock(indent + 2));
        continue;
      }

      const pair = splitKeyValue(itemText);
      if (!pair) {
        items.push(parseScalar(itemText));
        continue;
      }

      const [key, value] = pair;
      const item: Record<string, unknown> = {
        [key]: value ? parseScalar(value) : parseBlock(indent + 2)
      };
      if (state.index < lines.length && lines[state.index].indent > indent) {
        Object.assign(item, parseMapping(lines[state.index].indent));
      }
      items.push(item);
    }
    return items;
  }

  function parseMapping(indent: number): Record<string, unknown> {
    const object: Record<string, unknown> = {};
    while (state.index < lines.length) {
      const line = lines[state.index];
      if (line.indent !== indent || line.text.startsWith("- ")) break;
      const pair = splitKeyValue(line.text);
      if (!pair) throw new DocsStructureContractError(`invalid contract YAML line: ${line.text}`);
      const [key, value] = pair;
      state.index += 1;
      object[key] = value ? parseScalar(value) : parseBlock(indent + 2);
    }
    return object;
  }

  const parsed = parseBlock(0);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DocsStructureContractError("docs structure contract must be a YAML object");
  }
  return parsed as DocsStructureContract;
}

function entryDocTypes(entry: ContractEntry): string[] {
  if (entry.doc_type) return [entry.doc_type];
  return entry.doc_types ?? [];
}

function joinContractPath(...parts: string[]): string {
  return posix.normalize(parts.filter(Boolean).join("/"));
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeRoot(root: string): string {
  return withTrailingSlash(root);
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isUnderDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizeRelativePath(path).toLowerCase();
  const normalizedDirectory = withTrailingSlash(normalizeRelativePath(directory)).toLowerCase();
  return normalizedPath === normalizedDirectory.slice(0, -1) || normalizedPath.startsWith(normalizedDirectory);
}

function directoryFor(root: string, entry: ContractEntry): string {
  if (entry.path.endsWith("/")) return withTrailingSlash(joinContractPath(root, entry.path));
  return withTrailingSlash(posix.dirname(joinContractPath(root, entry.path)));
}

function outputPathFor(root: string, entry: ContractEntry, namingRule: string): string {
  if (!entry.path.endsWith("/")) return joinContractPath(root, entry.path);
  return joinContractPath(root, entry.path, namingRule);
}

function templateFor(entry: ContractEntry, docType: string): string | null {
  if (entry.template) return entry.template;
  const index = entryDocTypes(entry).indexOf(docType);
  return index >= 0 ? entry.templates?.[index] ?? null : null;
}

function isDocumentGroup(value: DocumentGroup | string[]): value is DocumentGroup {
  return !Array.isArray(value) && typeof value === "object" && value !== null;
}

export function createDocsStructureResolver(contract: DocsStructureContract): DocsStructureResolver {
  if (contract.version !== DOCS_STRUCTURE_CONTRACT_VERSION) {
    throw new DocsStructureContractError(`version must be ${DOCS_STRUCTURE_CONTRACT_VERSION}`);
  }
  const root = normalizeRoot(contract.human_docs?.root ?? "docs/");
  const machineRoot = normalizeRoot(contract.machine_layer?.root ?? joinContractPath(root, ".ccb/"));
  const namingDefault = contract.human_docs?.naming_default ?? "<模块/主题>-<文档类型>.md";
  const entries = new Map<string, ContractEntry>();
  for (const entry of contract.human_docs?.entries ?? []) {
    for (const docType of entryDocTypes(entry)) entries.set(docType, entry);
  }
  const availableDocTypes = [...entries.keys()];
  const referenceViews = new Set(contract.human_docs?.view_split?.reference_views ?? []);
  const integratedViews = new Set(contract.human_docs?.view_split?.integrated_views ?? []);

  const statusByDocType = new Map<string, { statusKind: string; definition: StatusDefinition }>();
  for (const [statusKind, definition] of Object.entries(contract.entity_status ?? {})) {
    for (const docType of definition.doc_types ?? []) {
      statusByDocType.set(docType, { statusKind, definition });
    }
  }

  const groupByDocType = new Map<string, { groupName: string; definition: DocumentGroup }>();
  for (const [groupName, definition] of Object.entries(contract.documents ?? {})) {
    if (!isDocumentGroup(definition)) continue;
    for (const docType of definition.doc_types ?? []) {
      groupByDocType.set(docType, { groupName, definition });
    }
  }

  const resolveDocTypeFromContract = (docType: string): ResolvedDocType => {
    const entry = entries.get(docType);
    if (!entry) throw new UnknownDocTypeError(docType, availableDocTypes);
    const namingRule = entry.path.endsWith("/") ? entry.naming ?? namingDefault : posix.basename(entry.path);
    const outputPathPattern = outputPathFor(root, entry, namingRule);
    const status = statusByDocType.get(docType);
    const group = groupByDocType.get(docType);
    return {
      docType,
      directory: directoryFor(root, entry),
      artifactPath: outputPathPattern,
      outputPathPattern,
      namingRule,
      template: templateFor(entry, docType),
      templates: entry.templates ?? (entry.template ? [entry.template] : []),
      maintainedBy: entry.maintained_by ?? null,
      splitByPart: Boolean(entry.split_by_part),
      viewKind: referenceViews.has(docType) ? "reference" : integratedViews.has(docType) ? "integrated" : null,
      hasStatus: Boolean(status),
      statusKind: status?.statusKind ?? null,
      statusFields: status?.definition.fields ?? [],
      statusValues: status?.definition.values ?? null,
      statusSource: status?.definition.source ?? null,
      documentGroup: group?.groupName ?? null,
      requiredFrontmatter: group?.definition.must_have ?? ["doc_type"],
      followsEntity: group?.definition.follows ?? null,
      documentStatusRule: group?.definition.status ?? null
    };
  };

  const resolveMachineLayerPathFromContract = (key: MachineLayerPathKey): string => {
    const suffix = MACHINE_LAYER_PATHS[key];
    const resolved = joinContractPath(machineRoot, suffix);
    return suffix.endsWith("/") ? withTrailingSlash(resolved) : resolved;
  };

  return {
    contract,
    availableDocTypes,
    humanDocsRoot: root,
    machineLayerRoot: machineRoot,
    resolveDocType: resolveDocTypeFromContract,
    resolveMachineLayerPath: resolveMachineLayerPathFromContract,
    inferDocTypesForPath(relativePath: string): string[] {
      const normalizedPath = normalizeRelativePath(relativePath);
      const matches: string[] = [];
      for (const docType of availableDocTypes) {
        const entry = entries.get(docType);
        if (!entry) continue;
        const resolved = resolveDocTypeFromContract(docType);
        if (!entry.path.endsWith("/") && normalizedPath === resolved.outputPathPattern) {
          matches.push(docType);
          continue;
        }
        if (entry.path.endsWith("/") && normalizedPath.startsWith(resolved.directory)) {
          matches.push(docType);
        }
      }
      return matches;
    },
    isHumanDocsPath(relativePath: string): boolean {
      return isUnderDirectory(relativePath, root) && !isUnderDirectory(relativePath, machineRoot);
    },
    shouldIgnoreMachineLayerScanPath(relativePath: string): boolean {
      return MACHINE_LAYER_SCAN_IGNORED_KEYS.some((key) =>
        isUnderDirectory(relativePath, resolveMachineLayerPathFromContract(key))
      );
    }
  };
}

export function loadDocsStructureResolver(options: { contractPath?: string } = {}): DocsStructureResolver {
  const contractPath = options.contractPath ?? process.env.CCB_DOCS_STRUCTURE_CONTRACT ?? DEFAULT_CONTRACT_PATH;
  if (!existsSync(contractPath)) {
    throw new DocsStructureContractError(`docs structure contract not found: ${contractPath}`);
  }
  return createDocsStructureResolver(parseYamlSubset(readFileSync(contractPath, "utf8")));
}

export function getDocsStructureResolver(): DocsStructureResolver {
  const contractPath = process.env.CCB_DOCS_STRUCTURE_CONTRACT ?? DEFAULT_CONTRACT_PATH;
  return getCachedDocsStructureResolver(contractPath);
}

export function resolveProjectDocsStructureContractPath(projectRoot: string): string {
  return join(projectRoot, "docs", ".ccb", "docs-structure-contract.yaml");
}

export function getDocsStructureResolverForProject(projectRoot: string): DocsStructureResolver {
  const overridePath = process.env.CCB_DOCS_STRUCTURE_CONTRACT;
  if (overridePath) {
    return getCachedDocsStructureResolver(overridePath);
  }
  const projectContractPath = resolveProjectDocsStructureContractPath(projectRoot);
  return getCachedDocsStructureResolver(existsSync(projectContractPath) ? projectContractPath : DEFAULT_CONTRACT_PATH);
}

export function resolveDocType(docType: string, options: { contractPath?: string } = {}): ResolvedDocType {
  return loadDocsStructureResolver(options).resolveDocType(docType);
}

function getCachedDocsStructureResolver(contractPath: string): DocsStructureResolver {
  if (!existsSync(contractPath)) {
    throw new DocsStructureContractError(`docs structure contract not found: ${contractPath}`);
  }
  const cached = cachedResolvers.get(contractPath);
  const mtimeMs = statSync(contractPath).mtimeMs;
  if (cached && cached.mtimeMs === mtimeMs) return cached.resolver;
  const resolver = loadDocsStructureResolver({ contractPath });
  cachedResolvers.set(contractPath, { mtimeMs, resolver });
  return resolver;
}
