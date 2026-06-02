import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerCapabilityRoutes } from "./capabilities.routes.js";
import {
  resolveCapability,
  resolveCapabilityDualRun,
  writeResolverTrace,
  type CapabilityDefinition
} from "./resolver.js";

const consultCapability: CapabilityDefinition = {
  capability_id: "analysis.consult",
  criticality: "governance_critical",
  provider_bindings: {
    candidates: [
      {
        binding_id: "codex_consult",
        provider: "codex",
        entrypoint: "ccb-execute"
      },
      {
        binding_id: "superclaude_spec_panel",
        provider: "superclaude",
        entrypoint: "/sc:spec-panel"
      },
      {
        binding_id: "claude_native_consult",
        provider: "claude_native",
        entrypoint: "inline_reasoning"
      }
    ]
  },
  degradation: {
    default_action: "escalate",
    allowed_fallbacks: []
  }
};

const globalCapabilities = [consultCapability];

async function withResolverDisableOldHint<T>(
  value: "true" | "false" | undefined,
  callback: () => T | Promise<T>
): Promise<T> {
  const previous = process.env.RESOLVER_DISABLE_OLD_HINT;
  if (value === undefined) {
    delete process.env.RESOLVER_DISABLE_OLD_HINT;
  } else {
    process.env.RESOLVER_DISABLE_OLD_HINT = value;
  }

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.RESOLVER_DISABLE_OLD_HINT;
    } else {
      process.env.RESOLVER_DISABLE_OLD_HINT = previous;
    }
  }
}

describe("capability resolver", () => {
  it("applies project.deny before global binding order", () => {
    const result = resolveCapability({
      capability_requested: "analysis.consult",
      globalCapabilities,
      projectOverrides: {
        deny: ["codex_consult"]
      }
    });

    expect(result.selected_binding?.binding_id).toBe("superclaude_spec_panel");
    expect(result.trace).toMatchObject({
      capability_requested: "analysis.consult",
      resolver_selected_binding: "superclaude_spec_panel",
      deny_count: 1,
      decision_mismatch: false
    });
    expect(result.decision_path).toContain("project.deny:codex_consult");
  });

  it("applies project.rank before user.deny", () => {
    const result = resolveCapability({
      capability_requested: "analysis.consult",
      globalCapabilities,
      projectOverrides: {
        rank: {
          "analysis.consult": ["codex_consult"]
        }
      },
      userOverrides: {
        deny: ["codex_consult"]
      }
    });

    expect(result.selected_binding?.binding_id).toBe("codex_consult");
    expect(result.trace.deny_count).toBe(0);
    expect(result.decision_path).toContain("project.rank:analysis.consult");
    expect(result.decision_path).not.toContain("user.deny:codex_consult");
  });

  it("applies user.deny when project overrides do not decide", () => {
    const result = resolveCapability({
      capability_requested: "analysis.consult",
      globalCapabilities,
      userOverrides: {
        deny: ["codex_consult"]
      }
    });

    expect(result.selected_binding?.binding_id).toBe("superclaude_spec_panel");
    expect(result.trace.deny_count).toBe(1);
    expect(result.decision_path).toContain("user.deny:codex_consult");
  });

  it("applies user.rank before global binding order", () => {
    const result = resolveCapability({
      capability_requested: "analysis.consult",
      globalCapabilities,
      userOverrides: {
        rank: {
          "analysis.consult": ["superclaude_spec_panel", "codex_consult"]
        }
      }
    });

    expect(result.selected_binding?.binding_id).toBe("superclaude_spec_panel");
    expect(result.decision_path).toContain("user.rank:analysis.consult");
  });

  it("falls back to global binding order when no override applies", () => {
    const result = resolveCapability({
      capability_requested: "analysis.consult",
      globalCapabilities
    });

    expect(result.selected_binding?.binding_id).toBe("codex_consult");
    expect(result.decision_path).toContain("global:candidate_order");
  });

  it("marks decision_mismatch when old hint/sc path selects a different binding in dual-run mode", async () => {
    await withResolverDisableOldHint("false", () => {
      const result = resolveCapabilityDualRun({
        capability_requested: "analysis.consult",
        globalCapabilities,
        oldHintResolver: () => ({
          binding_id: "superclaude_spec_panel",
          source: "/sc:spec-panel"
        })
      });

      expect(result.selected_binding?.binding_id).toBe("codex_consult");
      expect(result.old_hint_binding?.binding_id).toBe("superclaude_spec_panel");
      expect(result.trace.old_hint_fallback_count).toBe(1);
      expect(result.trace.decision_mismatch).toBe(true);
    });
  });

  it("defaults to primary-only mode and skips the old hint resolver", async () => {
    await withResolverDisableOldHint(undefined, () => {
      let oldHintCalled = false;
      const result = resolveCapabilityDualRun({
        capability_requested: "analysis.consult",
        globalCapabilities,
        oldHintResolver: () => {
          oldHintCalled = true;
          return {
            binding_id: "superclaude_spec_panel",
            source: "/sc:spec-panel"
          };
        }
      });

      expect(oldHintCalled).toBe(false);
      expect(result.selected_binding?.binding_id).toBe("codex_consult");
      expect(result.old_hint_binding).toBeNull();
      expect(result.trace.old_hint_fallback_count).toBe(0);
      expect(result.trace.decision_mismatch).toBe(false);
    });
  });

  it("keeps project.rank selection in primary-only mode without mismatch", async () => {
    await withResolverDisableOldHint("true", () => {
      const result = resolveCapabilityDualRun({
        capability_requested: "analysis.consult",
        globalCapabilities,
        projectOverrides: {
          rank: {
            "analysis.consult": ["superclaude_spec_panel", "codex_consult"]
          }
        },
        oldHintResolver: () => ({
          binding_id: "codex_consult",
          source: "/sc:spec-panel"
        })
      });

      expect(result.selected_binding?.binding_id).toBe("superclaude_spec_panel");
      expect(result.old_hint_binding).toBeNull();
      expect(result.trace.old_hint_fallback_count).toBe(0);
      expect(result.trace.decision_mismatch).toBe(false);
    });
  });

  it("keeps user.rank selection in primary-only mode without mismatch", async () => {
    await withResolverDisableOldHint("true", () => {
      const result = resolveCapabilityDualRun({
        capability_requested: "analysis.consult",
        globalCapabilities,
        userOverrides: {
          rank: {
            "analysis.consult": ["superclaude_spec_panel", "codex_consult"]
          }
        },
        oldHintResolver: () => ({
          binding_id: "codex_consult",
          source: "/sc:spec-panel"
        })
      });

      expect(result.selected_binding?.binding_id).toBe("superclaude_spec_panel");
      expect(result.old_hint_binding).toBeNull();
      expect(result.trace.old_hint_fallback_count).toBe(0);
      expect(result.trace.decision_mismatch).toBe(false);
    });
  });

  it("keeps global fallback in primary-only API mode and persists a non-mismatch trace", async () => {
    await withResolverDisableOldHint("true", async () => {
      const traceDir = await mkdtemp(join(tmpdir(), "resolver-api-primary-only-traces-"));
      const app = Fastify();
      await app.register(registerCapabilityRoutes, {
        traceDir
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/capabilities/resolve",
          payload: {
            task_id: "api-primary-only-task-1",
            capability_requested: "analysis.consult",
            global_capabilities: globalCapabilities,
            old_hint_binding: {
              binding_id: "superclaude_spec_panel",
              source: "/sc:spec-panel"
            }
          }
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.selected_binding.binding_id).toBe("codex_consult");
        expect(body.old_hint_binding).toBeNull();
        expect(body.trace).toMatchObject({
          capability_requested: "analysis.consult",
          resolver_selected_binding: "codex_consult",
          old_hint_fallback_count: 0,
          decision_mismatch: false
        });

        const persisted = JSON.parse(await readFile(join(traceDir, "api-primary-only-task-1.json"), "utf-8"));
        expect(persisted).toEqual(body.trace);
      } finally {
        await app.close();
      }
    });
  });

  it("writes resolver trace JSON under the task id filename", async () => {
    const traceDir = await mkdtemp(join(tmpdir(), "resolver-traces-"));
    const result = resolveCapability({
      capability_requested: "analysis.consult",
      globalCapabilities
    });

    const tracePath = await writeResolverTrace(result.trace, {
      taskId: "task-123",
      traceDir
    });

    expect(tracePath.endsWith("task-123.json")).toBe(true);
    const persisted = JSON.parse(await readFile(tracePath, "utf-8"));
    expect(persisted).toEqual(result.trace);
  });

  it("rejects resolver trace writes when the 7-field schema shape drifts", async () => {
    const traceDir = await mkdtemp(join(tmpdir(), "resolver-traces-invalid-"));
    const result = resolveCapability({
      capability_requested: "analysis.consult",
      globalCapabilities
    });

    await expect(
      writeResolverTrace(
        {
          ...result.trace,
          resolver_selected_binding: 42
        } as never,
        {
          taskId: "invalid-trace",
          traceDir
        }
      )
    ).rejects.toThrow(/resolver trace schema invalid/);
  });

  it("writes resolver trace when the API endpoint resolves a capability in dual-run mode", async () => {
    await withResolverDisableOldHint("false", async () => {
      const traceDir = await mkdtemp(join(tmpdir(), "resolver-api-traces-"));
      const app = Fastify();
      await app.register(registerCapabilityRoutes, {
        traceDir
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/capabilities/resolve",
          payload: {
            task_id: "api-task-1",
            capability_requested: "analysis.consult",
            global_capabilities: globalCapabilities,
            old_hint_binding: {
              binding_id: "superclaude_spec_panel",
              source: "/sc:spec-panel"
            }
          }
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.trace).toMatchObject({
          capability_requested: "analysis.consult",
          resolver_selected_binding: "codex_consult",
          old_hint_fallback_count: 1,
          decision_mismatch: true
        });

        const persisted = JSON.parse(await readFile(join(traceDir, "api-task-1.json"), "utf-8"));
        expect(persisted).toEqual(body.trace);
      } finally {
        await app.close();
      }
    });
  });
});
