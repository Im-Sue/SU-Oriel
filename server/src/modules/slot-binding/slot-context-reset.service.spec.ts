import assert from "node:assert/strict";

import { test } from "vitest";

import { SlotContextResetService } from "./slot-context-reset.service.js";

test("SlotContextResetService sends /new to every agent in the slot window", async () => {
  const tmuxCalls: Array<{ socketPath: string; args: string[] }> = [];
  const service = new SlotContextResetService(
    {
      async projectView() {
        return {
          namespace: {
            socket_path: "/tmp/ccb-tmux.sock"
          },
          windows: [
            {
              name: "slot-1",
              agents: ["slot1_claude", "slot1_codex"]
            }
          ],
          agents: [
            {
              name: "slot1_claude",
              pane_id: "%1"
            },
            {
              name: "slot1_codex",
              pane_id: "%2"
            }
          ]
        };
      }
    },
    {
      runTmux: async (socketPath, args) => {
        tmuxCalls.push({ socketPath, args });
      }
    }
  );

  const result = await service.resetSlotContext({
    projectId: "project-1",
    slotId: "slot-1",
    requirementId: "req-1",
    trigger: "bind"
  });

  assert.equal(result.status, "ok");
  assert.equal(result.sent, 2);
  assert.deepEqual(result.agentNames, ["slot1_claude", "slot1_codex"]);
  assert.deepEqual(
    tmuxCalls.filter((call) => call.args.includes("-l")).map((call) => call.args),
    [
      ["send-keys", "-t", "%1", "-l", "/new"],
      ["send-keys", "-t", "%2", "-l", "/new"]
    ]
  );
  assert.equal(tmuxCalls.every((call) => call.socketPath === "/tmp/ccb-tmux.sock"), true);
});

test("SlotContextResetService records per-agent delivery failures and keeps sending", async () => {
  const service = new SlotContextResetService(
    {
      async projectView() {
        return {
          namespace: {
            socket_path: "/tmp/ccb-tmux.sock"
          },
          windows: [
            {
              name: "slot-1",
              agents: ["slot1_claude", "slot1_codex"]
            }
          ],
          agents: [
            {
              name: "slot1_claude",
              pane_id: "%1"
            },
            {
              name: "slot1_codex",
              pane_id: "%2"
            }
          ]
        };
      }
    },
    {
      runTmux: async (_socketPath, args) => {
        if (args.includes("%1") && args.includes("C-u")) {
          throw new Error("pane unavailable");
        }
      }
    }
  );

  const result = await service.resetSlotContext({
    projectId: "project-1",
    slotId: "slot-1",
    trigger: "release"
  });

  assert.equal(result.status, "partial");
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.results.map((item) => [item.agent, item.status]), [
    ["slot1_claude", "failed"],
    ["slot1_codex", "sent"]
  ]);
});
