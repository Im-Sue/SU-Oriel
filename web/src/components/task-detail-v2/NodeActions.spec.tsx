import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NodeActions } from "./NodeActions.js";

describe("NodeActions", () => {
  it("renders nothing when all actions are system_only", () => {
    const { container } = render(
      <NodeActions
        actions={[
          {
            transitionId: "implementation__on_receipt_ready__to__review",
            label: "进入评审",
            guardStatus: "satisfied",
            applicability: "system_only"
          }
        ]}
        error={null}
      />
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
