import { describe, expect, it } from "vitest";

import { AnchorSessionResolverError, selectAnchorSession } from "./anchor-session-resolver.js";

describe("anchor-terminal shared session resolver", () => {
  it("selects the unique session matching a non SU-CCB anchor path", () => {
    expect(
      selectAnchorSession({
        anchorPath: "/repo/realtime_translator-task-task-1",
        sessions: ["unrelated", "ccb-realtime_translator-task-task-1-a1b2"]
      })
    ).toBe("ccb-realtime_translator-task-task-1-a1b2");
  });

  it("accepts a single runtime session without relying on a project-name prefix", () => {
    expect(
      selectAnchorSession({
        anchorPath: "/repo/another-project-task-task-2",
        sessions: ["runtime-generated-session"]
      })
    ).toBe("runtime-generated-session");
  });

  it("fails loud when multiple sessions match the anchor path", () => {
    expect(() =>
      selectAnchorSession({
        anchorPath: "/repo/realtime_translator-task-task-3",
        sessions: [
          "ccb-realtime_translator-task-task-3-a1b2",
          "ccb-realtime_translator-task-task-3-c3d4"
        ]
      })
    ).toThrow(AnchorSessionResolverError);
  });

  it("fails loud when multiple sessions exist and none can be tied to anchorPath", () => {
    expect(() =>
      selectAnchorSession({
        anchorPath: "/repo/realtime_translator-task-task-4",
        sessions: ["one", "two"]
      })
    ).toThrow(AnchorSessionResolverError);
  });
});
