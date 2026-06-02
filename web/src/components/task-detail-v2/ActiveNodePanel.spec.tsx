import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActiveNodePanel } from "./ActiveNodePanel.js";

describe("ActiveNodePanel", () => {
  it("does not render the actions section when actionsSlot is null", () => {
    render(
      <ActiveNodePanel
        actionsSlot={null}
        isCurrent={true}
        node={{ id: "implementation", label: "执行实现", status: "in_progress" }}
      />
    );

    expect(screen.queryByRole("region", { name: "可执行动作" })).not.toBeInTheDocument();
    expect(screen.queryByText("可执行动作")).not.toBeInTheDocument();
  });
});
