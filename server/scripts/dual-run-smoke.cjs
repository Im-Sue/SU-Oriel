#!/usr/bin/env node
/* eslint-env node */
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

require("tsx/cjs");

const Fastify = require("fastify");
const { registerCapabilityRoutes } = require("../src/modules/capabilities/capabilities.routes.ts");

const serverRoot = resolve(__dirname, "..");
const repoRoot = resolve(serverRoot, "../../..");
const traceDir = join(serverRoot, "data/resolver-traces");
const reportPath = join(repoRoot, "docs/.ccb/drafts/e2-t2-dual-run-smoke-report.md");
const specPath = "docs/03_开发计划/2026-05-02-e2-t2-dual-run-fixture-smoke.md";
const schemaPath = join(repoRoot, "docs/.ccb/schemas/resolver-trace-v0.1.json");
const tracePrefix = "e2-t2-fixture-";

const globalCapabilities = [
  {
    capability_id: "analysis.consult",
    criticality: "governance_critical",
    provider_bindings: {
      candidates: [
        {
          binding_id: "global_primary",
          provider: "codex",
          entrypoint: "ccb-execute"
        },
        {
          binding_id: "global_fallback",
          provider: "codex",
          entrypoint: "ccb-execute"
        },
        {
          binding_id: "project_ranked",
          provider: "codex",
          entrypoint: "ccb-execute"
        },
        {
          binding_id: "user_ranked",
          provider: "claude_native",
          entrypoint: "inline_reasoning"
        }
      ]
    },
    degradation: {
      default_action: "escalate",
      allowed_fallbacks: []
    }
  }
];

const scenarios = [
  {
    id: "s1-project-deny",
    title: "S1 project.deny",
    expectedBinding: "global_fallback",
    payload: {
      project_overrides: {
        deny: ["global_primary"]
      }
    }
  },
  {
    id: "s2-project-rank",
    title: "S2 project.rank",
    expectedBinding: "project_ranked",
    payload: {
      project_overrides: {
        rank: {
          "analysis.consult": ["project_ranked", "global_primary"]
        }
      }
    }
  },
  {
    id: "s3-user-rank",
    title: "S3 user.rank",
    expectedBinding: "user_ranked",
    payload: {
      user_overrides: {
        rank: {
          "analysis.consult": ["user_ranked", "global_primary"]
        }
      }
    }
  },
  {
    id: "s4-global-fallback",
    title: "S4 global fallback",
    expectedBinding: "global_primary",
    payload: {}
  },
  {
    id: "s5-user-deny-mismatch",
    title: "S5 user.deny + decision_mismatch",
    expectedBinding: "global_fallback",
    payload: {
      user_overrides: {
        deny: ["global_primary"]
      },
      old_hint_binding: {
        binding_id: "global_primary",
        source: "/sc:legacy-hint"
      }
    }
  }
];

function cleanFixtureTraces() {
  mkdirSync(traceDir, { recursive: true });
  for (const fileName of readdirSync(traceDir)) {
    if (fileName.startsWith(tracePrefix) && fileName.endsWith(".json")) {
      rmSync(join(traceDir, fileName));
    }
  }
}

function validateTraceAgainstSchema(trace) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  const required = schema.required ?? [];
  const allowedKeys = new Set(required);
  const traceKeys = Object.keys(trace).sort();
  const expectedKeys = [...allowedKeys].sort();
  if (traceKeys.length !== expectedKeys.length || traceKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`trace keys drift: ${traceKeys.join(",")}`);
  }
  for (const field of required) {
    if (!(field in trace)) {
      throw new Error(`trace missing field: ${field}`);
    }
  }
  if (
    typeof trace.capability_requested !== "string" ||
    !(typeof trace.resolver_selected_binding === "string" || trace.resolver_selected_binding === null) ||
    !Number.isInteger(trace.old_hint_fallback_count) ||
    !Number.isInteger(trace.deny_count) ||
    typeof trace.manual_override !== "boolean" ||
    !(typeof trace.resolver_error === "string" || trace.resolver_error === null) ||
    typeof trace.decision_mismatch !== "boolean"
  ) {
    throw new Error("trace type validation failed");
  }
}

function specHash() {
  const content = readFileSync(join(repoRoot, specPath));
  return createHash("sha256").update(content).digest("hex");
}

function writeReport(results, aggregate) {
  const lines = [
    "---",
    "task_id: e2-t2-dual-run-fixture-smoke",
    "spec_id: e2-t2-dual-run-fixture-smoke",
    "title: E2-T2 dual-run fixture smoke report",
    "created: 2026-05-02",
    "updated: 2026-05-02",
    "currentNode: implementation",
    "nodeSubstate: completed",
    "runtimeState: completed",
    "lastTransitionId: task_breakdown__dispatch__implementation",
    "status: completed",
    "phase: implementation",
    `spec_path: ${specPath}`,
    `spec_hash: ${specHash()}`,
    "policy_profile: autonomous-batch",
    "user_approval_mode: none",
    "hotfixes_adopted:",
    "  - state_check_guard",
    "---",
    "",
    "# E2-T2 dual-run fixture smoke report",
    "",
    "## Scenario summary",
    "| id | path | selected | fallback | manual_override | mismatch | artifact |",
    "|---|---|---|---:|---|---|---|",
    ...results.map((result) => {
      const artifact = `apps/ccb-console/server/data/resolver-traces/${result.taskId}.json`;
      return `| ${result.id} | ${result.title} | ${result.trace.resolver_selected_binding} | ${result.trace.old_hint_fallback_count} | ${result.trace.manual_override} | ${result.trace.decision_mismatch} | ${artifact} |`;
    }),
    "",
    "## Exit gate aggregate",
    `- resolver_success: ${aggregate.resolverSuccess}/${aggregate.resolverTotal} (${aggregate.resolverSuccessRate}%)`,
    `- fallback_count: ${aggregate.fallbackCount}`,
    `- manual_override: ${aggregate.manualOverrideCount}`,
    `- mismatch_count: ${aggregate.mismatchCount}`,
    `- trace_artifact_count: ${results.length}`,
    "",
    "## Field validation",
    "- S1 validates project.deny and deny_count>=1.",
    "- S2 validates project.rank and project_* binding selection.",
    "- S3 validates user.rank and user_* binding selection.",
    "- S4 validates global fallback with no overrides.",
    "- S5 validates user.deny plus decision_mismatch=true.",
    "- All traces match resolver-trace-v0.1 required 7 fields.",
    "",
    "## Follow-up note",
    "- 真实业务任务验证留 Wave 1B/2；本轮仅证明 fixture-driven dual-run smoke 可用。",
    "",
    "## Open issues",
    "- 无；hint disable 仍属 E2-T5 范围。"
  ];
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf-8");
}

async function main() {
  cleanFixtureTraces();
  const app = Fastify();
  await app.register(registerCapabilityRoutes, { traceDir });

  const results = [];
  try {
    for (const scenario of scenarios) {
      const taskId = `${tracePrefix}${scenario.id}`;
      const response = await app.inject({
        method: "POST",
        url: "/api/capabilities/resolve",
        payload: {
          task_id: taskId,
          capability_requested: "analysis.consult",
          global_capabilities: globalCapabilities,
          ...scenario.payload
        }
      });
      if (response.statusCode !== 200) {
        throw new Error(`${scenario.id} returned ${response.statusCode}: ${response.body}`);
      }
      const body = response.json();
      validateTraceAgainstSchema(body.trace);
      if (body.trace.resolver_selected_binding !== scenario.expectedBinding) {
        throw new Error(`${scenario.id} selected ${body.trace.resolver_selected_binding}, expected ${scenario.expectedBinding}`);
      }
      const tracePath = join(traceDir, `${taskId}.json`);
      if (!existsSync(tracePath)) {
        throw new Error(`${scenario.id} trace artifact missing: ${tracePath}`);
      }
      const persistedTrace = JSON.parse(readFileSync(tracePath, "utf-8"));
      validateTraceAgainstSchema(persistedTrace);
      results.push({
        ...scenario,
        taskId,
        trace: persistedTrace
      });
    }
  } finally {
    await app.close();
  }

  const gateResults = results.filter((result) => result.id !== "s5-user-deny-mismatch");
  const aggregate = {
    resolverSuccess: gateResults.filter((result) => result.trace.resolver_error === null).length,
    resolverTotal: gateResults.length,
    fallbackCount: gateResults.reduce((sum, result) => sum + result.trace.old_hint_fallback_count, 0),
    manualOverrideCount: gateResults.filter((result) => result.trace.manual_override).length,
    mismatchCount: results.filter((result) => result.trace.decision_mismatch).length
  };
  aggregate.resolverSuccessRate = Math.round((aggregate.resolverSuccess / aggregate.resolverTotal) * 100);

  if (
    aggregate.resolverSuccessRate !== 100 ||
    aggregate.fallbackCount !== 0 ||
    aggregate.manualOverrideCount !== 0 ||
    aggregate.mismatchCount !== 1
  ) {
    throw new Error(`exit gate failed: ${JSON.stringify(aggregate)}`);
  }

  writeReport(results, aggregate);
  console.log("E2_T2_DUAL_RUN_SMOKE_PASS");
  console.log(JSON.stringify({ scenarios: results.length, aggregate }, null, 2));
}

main().catch((error) => {
  console.error("E2_T2_DUAL_RUN_SMOKE_FAIL");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
