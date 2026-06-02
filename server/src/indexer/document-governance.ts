/**
 * Single source of truth for document **governance** derivation.
 *
 * The document-map cache (indexer) and the documents list API (pr2) both need to
 * derive a document's tier / bound-requirement / entity status / task identity from
 * its frontmatter. Keeping that logic in one pure builder stops the two call sites
 * from forking the rules. The indexer feeds parsed docs + a status map built from
 * parsed requirements; pr2 feeds DB-backed docs + a status map built from
 * `Requirement.status`. Same rules, different inputs.
 *
 * Pure: no IO, no resolver dependency. Resolver-derived facts (which doc types carry
 * status, which follow a requirement, whether the path is archived) are passed in as
 * explicit inputs so the builder stays unit-testable.
 */

export const DOC_MAP_TIER_ORDER = ["生效中", "历史", "归档"] as const;
export type DocMapTier = (typeof DOC_MAP_TIER_ORDER)[number];

/** Resolver-derived facts about a doc type, or null when the type is unknown to the resolver. */
export interface DocGovernanceDocTypeInfo {
  hasStatus: boolean;
  followsEntity: string | null;
}

/** Normalized minimal doc shape the builder consumes. */
export interface DocGovernanceInput {
  kind: string;
  /** Whether the doc lives under the archive directory (caller resolves the dir). */
  isArchivePath: boolean;
  /** Fallback task identity for dev_task when frontmatter.task_id is absent. */
  taskKey: string | null;
  /** Raw frontmatter; the builder centralizes requirement_id / task_id / status / current_node reads. */
  frontmatter: Record<string, string | undefined>;
  parseStatus: string;
}

export interface DocGovernanceContext {
  /** requirementId -> requirement entity status (parsed requirements in the indexer; DB Requirement.status in pr2). */
  requirementStatusById: Map<string, string>;
  /** resolver.resolveDocType(kind) facts, or null when kind is not an available doc type. */
  docTypeInfo: DocGovernanceDocTypeInfo | null;
}

export interface DocGovernance {
  tier: DocMapTier;
  requirementId: string | null;
  entityStatus: string | null;
  taskId: string | null;
  healthFlags: { parseError: boolean };
}

const HISTORICAL_REQUIREMENT_STATUSES = new Set(["delivered", "deferred", "cancelled"]);
const HISTORICAL_DEV_TASK_STATUSES = new Set(["done", "cancelled"]);
const HISTORICAL_ADR_STATUSES = new Set(["superseded", "deprecated"]);

export function isHistoricalRequirementStatus(status: string | null | undefined): boolean {
  return HISTORICAL_REQUIREMENT_STATUSES.has(status?.trim() ?? "");
}

/** Normalize requirement binding: frontmatter.requirement_id -> requirementId. */
export function normalizeRequirementId(frontmatter: Record<string, string | undefined>): string | null {
  return frontmatter.requirement_id?.trim() || null;
}

/** Normalize task identity: dev_task frontmatter.task_id (fallback taskKey) -> taskId; null for non-dev_task. */
export function normalizeTaskId(
  kind: string,
  frontmatter: Record<string, string | undefined>,
  taskKey: string | null
): string | null {
  if (kind !== "dev_task") return null;
  return frontmatter.task_id?.trim() || taskKey || null;
}

function deriveTier(input: DocGovernanceInput, requirementId: string | null, ctx: DocGovernanceContext): DocMapTier {
  if (input.isArchivePath) return "归档";
  const { kind, frontmatter } = input;
  if (kind === "requirement") {
    return isHistoricalRequirementStatus(frontmatter.status) ? "历史" : "生效中";
  }
  if (kind === "technical_design") {
    const status = requirementId ? ctx.requirementStatusById.get(requirementId) : null;
    return isHistoricalRequirementStatus(status) ? "历史" : "生效中";
  }
  if (kind === "dev_task") {
    return HISTORICAL_DEV_TASK_STATUSES.has(frontmatter.status?.trim() ?? "") ? "历史" : "生效中";
  }
  if (kind === "adr") {
    return HISTORICAL_ADR_STATUSES.has(frontmatter.status?.trim() ?? "") ? "历史" : "生效中";
  }
  return "生效中";
}

function deriveEntityStatus(input: DocGovernanceInput, requirementId: string | null, ctx: DocGovernanceContext): string | null {
  const info = ctx.docTypeInfo;
  if (info?.hasStatus) {
    return input.frontmatter.status?.trim() || input.frontmatter.current_node?.trim() || null;
  }
  if (info?.followsEntity === "requirement") {
    return requirementId ? ctx.requirementStatusById.get(requirementId) ?? null : null;
  }
  return null;
}

/** Derive the governance projection for a single document. Pure. */
export function deriveDocumentGovernance(input: DocGovernanceInput, ctx: DocGovernanceContext): DocGovernance {
  const requirementId = normalizeRequirementId(input.frontmatter);
  return {
    tier: deriveTier(input, requirementId, ctx),
    requirementId,
    entityStatus: deriveEntityStatus(input, requirementId, ctx),
    taskId: normalizeTaskId(input.kind, input.frontmatter, input.taskKey),
    healthFlags: { parseError: input.parseStatus === "parse_error" }
  };
}
