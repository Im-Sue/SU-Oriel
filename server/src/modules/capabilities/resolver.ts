import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CapabilityBinding {
  binding_id: string;
  provider: string;
  entrypoint: string;
  mode?: string;
  role?: string;
  arguments_template?: unknown;
  timeout_seconds?: number;
}

export interface CapabilityDefinition {
  capability_id: string;
  criticality: string;
  provider_bindings: {
    candidates: CapabilityBinding[];
  };
  degradation?: {
    default_action: string;
    allowed_fallbacks?: string[];
  };
}

export interface CapabilityOverrides {
  deny?: string[];
  rank?: Record<string, string[]>;
  [capabilityId: string]: unknown;
}

export interface ResolverTrace {
  capability_requested: string;
  resolver_selected_binding: string | null;
  old_hint_fallback_count: number;
  deny_count: number;
  manual_override: boolean;
  resolver_error: string | null;
  decision_mismatch: boolean;
}

export interface CapabilityResolution {
  capability_requested: string;
  selected_binding: CapabilityBinding | null;
  status: "resolved" | "denied" | "not_found" | "unavailable";
  decision_path: string[];
  trace: ResolverTrace;
}

export interface OldHintDecision {
  binding_id: string | null;
  source: string;
}

export interface DualRunCapabilityResolution extends CapabilityResolution {
  old_hint_binding: OldHintDecision | null;
}

export interface ResolveCapabilityInput {
  capability_requested: string;
  globalCapabilities: CapabilityDefinition[];
  projectOverrides?: CapabilityOverrides;
  userOverrides?: CapabilityOverrides;
  manual_override?: boolean;
  isBindingAvailable?: (binding: CapabilityBinding) => boolean;
}

export interface ResolveCapabilityDualRunInput extends ResolveCapabilityInput {
  oldHintResolver?: () => OldHintDecision | null;
}

export interface WriteResolverTraceOptions {
  taskId: string;
  traceDir?: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(currentDir, "../../..");
const DEFAULT_TRACE_DIR = join(serverRoot, "data/resolver-traces");
const TRACE_FIELD_NAMES = [
  "capability_requested",
  "resolver_selected_binding",
  "old_hint_fallback_count",
  "deny_count",
  "manual_override",
  "resolver_error",
  "decision_mismatch"
];

function isOldHintDisabled(): boolean {
  // Default true for v0.4 v1 primary-only mode; set RESOLVER_DISABLE_OLD_HINT=false to re-enable dual-run.
  return process.env.RESOLVER_DISABLE_OLD_HINT !== "false";
}

function emptyTrace(capabilityRequested: string, manualOverride: boolean): ResolverTrace {
  return {
    capability_requested: capabilityRequested,
    resolver_selected_binding: null,
    old_hint_fallback_count: 0,
    deny_count: 0,
    manual_override: manualOverride,
    resolver_error: null,
    decision_mismatch: false
  };
}

function findCapability(capabilityRequested: string, globalCapabilities: CapabilityDefinition[]): CapabilityDefinition | null {
  return globalCapabilities.find((capability) => capability.capability_id === capabilityRequested) ?? null;
}

function getDenyList(overrides?: CapabilityOverrides): string[] {
  if (Array.isArray(overrides?.deny)) {
    return overrides.deny;
  }
  return [];
}

function getRankList(capabilityRequested: string, overrides?: CapabilityOverrides): string[] | null {
  if (overrides?.rank?.[capabilityRequested]) {
    return overrides.rank[capabilityRequested];
  }

  const nested = overrides?.[capabilityRequested];
  if (
    nested &&
    typeof nested === "object" &&
    "rank" in nested &&
    Array.isArray((nested as { rank?: unknown }).rank)
  ) {
    return (nested as { rank: string[] }).rank;
  }

  return null;
}

function getNestedDenyList(capabilityRequested: string, overrides?: CapabilityOverrides): string[] {
  const nested = overrides?.[capabilityRequested];
  if (
    nested &&
    typeof nested === "object" &&
    "deny" in nested &&
    Array.isArray((nested as { deny?: unknown }).deny)
  ) {
    return (nested as { deny: string[] }).deny;
  }
  return [];
}

function reorderBindings(bindings: CapabilityBinding[], rankList: string[]): CapabilityBinding[] {
  const byId = new Map(bindings.map((binding) => [binding.binding_id, binding]));
  const ranked = rankList.flatMap((bindingId) => {
    const binding = byId.get(bindingId);
    return binding ? [binding] : [];
  });
  const rankedIds = new Set(ranked.map((binding) => binding.binding_id));
  const remainder = bindings.filter((binding) => !rankedIds.has(binding.binding_id));
  return [...ranked, ...remainder];
}

function applyDeny(
  bindings: CapabilityBinding[],
  denyList: string[],
  decisionPath: string[],
  trace: ResolverTrace,
  source: "project.deny" | "user.deny"
): CapabilityBinding[] {
  if (denyList.length === 0) {
    return bindings;
  }

  const denySet = new Set(denyList);
  const before = bindings.length;
  const filtered = bindings.filter((binding) => !denySet.has(binding.binding_id));
  const deniedBindingIds = bindings
    .filter((binding) => denySet.has(binding.binding_id))
    .map((binding) => binding.binding_id);

  for (const bindingId of deniedBindingIds) {
    decisionPath.push(`${source}:${bindingId}`);
  }
  trace.deny_count += before - filtered.length;
  return filtered;
}

function selectAvailableBinding(
  bindings: CapabilityBinding[],
  isBindingAvailable: (binding: CapabilityBinding) => boolean
): CapabilityBinding | null {
  return bindings.find((binding) => isBindingAvailable(binding)) ?? null;
}

export function resolveCapability(input: ResolveCapabilityInput): CapabilityResolution {
  const manualOverride = input.manual_override ?? false;
  const trace = emptyTrace(input.capability_requested, manualOverride);
  const decisionPath: string[] = [];
  const isBindingAvailable = input.isBindingAvailable ?? (() => true);

  try {
    const capability = findCapability(input.capability_requested, input.globalCapabilities);
    if (!capability) {
      trace.resolver_error = "capability_not_found";
      return {
        capability_requested: input.capability_requested,
        selected_binding: null,
        status: "not_found",
        decision_path: ["global:not_found"],
        trace
      };
    }

    const projectDeny = [...getDenyList(input.projectOverrides), ...getNestedDenyList(input.capability_requested, input.projectOverrides)];
    if (projectDeny.includes(input.capability_requested)) {
      trace.deny_count += 1;
      trace.resolver_error = "capability_denied_by_project";
      return {
        capability_requested: input.capability_requested,
        selected_binding: null,
        status: "denied",
        decision_path: [`project.deny:${input.capability_requested}`],
        trace
      };
    }

    let candidates = [...capability.provider_bindings.candidates];
    candidates = applyDeny(candidates, projectDeny, decisionPath, trace, "project.deny");

    const projectRank = getRankList(input.capability_requested, input.projectOverrides);
    if (projectRank) {
      decisionPath.push(`project.rank:${input.capability_requested}`);
      candidates = reorderBindings(candidates, projectRank);
    } else {
      const userDeny = [...getDenyList(input.userOverrides), ...getNestedDenyList(input.capability_requested, input.userOverrides)];
      if (userDeny.includes(input.capability_requested)) {
        trace.deny_count += 1;
        trace.resolver_error = "capability_denied_by_user";
        return {
          capability_requested: input.capability_requested,
          selected_binding: null,
          status: "denied",
          decision_path: [...decisionPath, `user.deny:${input.capability_requested}`],
          trace
        };
      }

      candidates = applyDeny(candidates, userDeny, decisionPath, trace, "user.deny");

      const userRank = getRankList(input.capability_requested, input.userOverrides);
      if (userRank) {
        decisionPath.push(`user.rank:${input.capability_requested}`);
        candidates = reorderBindings(candidates, userRank);
      } else {
        decisionPath.push("global:candidate_order");
      }
    }

    const selected = selectAvailableBinding(candidates, isBindingAvailable);
    trace.resolver_selected_binding = selected?.binding_id ?? null;
    if (!selected) {
      trace.resolver_error = "no_available_binding";
    }

    return {
      capability_requested: input.capability_requested,
      selected_binding: selected,
      status: selected ? "resolved" : "unavailable",
      decision_path: decisionPath,
      trace
    };
  } catch (error) {
    trace.resolver_error = error instanceof Error ? error.message : String(error);
    return {
      capability_requested: input.capability_requested,
      selected_binding: null,
      status: "unavailable",
      decision_path: [...decisionPath, "resolver:error"],
      trace
    };
  }
}

export function resolveCapabilityDualRun(input: ResolveCapabilityDualRunInput): DualRunCapabilityResolution {
  const resolution = resolveCapability(input);
  if (isOldHintDisabled()) {
    return {
      ...resolution,
      old_hint_binding: null
    };
  }

  const oldHintBinding = input.oldHintResolver?.() ?? null;
  if (oldHintBinding) {
    resolution.trace.old_hint_fallback_count = 1;
    resolution.trace.decision_mismatch = resolution.trace.resolver_selected_binding !== oldHintBinding.binding_id;
  }

  return {
    ...resolution,
    old_hint_binding: oldHintBinding
  };
}

function validateResolverTrace(trace: ResolverTrace): void {
  const rawTrace = trace as unknown as Record<string, unknown>;
  const keys = Object.keys(rawTrace).sort();
  const expectedKeys = [...TRACE_FIELD_NAMES].sort();
  const hasExactKeys = keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
  const hasValidTypes =
    typeof rawTrace.capability_requested === "string" &&
    (typeof rawTrace.resolver_selected_binding === "string" || rawTrace.resolver_selected_binding === null) &&
    Number.isInteger(rawTrace.old_hint_fallback_count) &&
    Number(rawTrace.old_hint_fallback_count) >= 0 &&
    Number.isInteger(rawTrace.deny_count) &&
    Number(rawTrace.deny_count) >= 0 &&
    typeof rawTrace.manual_override === "boolean" &&
    (typeof rawTrace.resolver_error === "string" || rawTrace.resolver_error === null) &&
    typeof rawTrace.decision_mismatch === "boolean";

  if (!hasExactKeys || !hasValidTypes) {
    throw new Error("resolver trace schema invalid");
  }
}

export async function writeResolverTrace(
  trace: ResolverTrace,
  options: WriteResolverTraceOptions
): Promise<string> {
  validateResolverTrace(trace);
  const traceDir = options.traceDir ?? DEFAULT_TRACE_DIR;
  await mkdir(traceDir, { recursive: true });
  const tracePath = join(traceDir, `${options.taskId}.json`);
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf-8");
  return tracePath;
}
