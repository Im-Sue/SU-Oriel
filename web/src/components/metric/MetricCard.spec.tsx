import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricCard } from "./MetricCard.js";

describe("MetricCard", () => {
  it("renders a single metric with tone, sub status and optional trend", () => {
    render(
      <MetricCard
        label="Blocked tasks"
        value={3}
        tone="warn"
        subStatus="Needs attention"
        trend={{ delta: 2, direction: "up" }}
      />
    );

    expect(screen.getByText("Blocked tasks")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByTestId("metric-card")).toHaveAttribute("data-tone", "warn");
  });

  it("omits the trend chip when no trend is provided", () => {
    render(<MetricCard label="Rounds today" value="8" tone="success" />);

    expect(screen.queryByTestId("metric-trend")).not.toBeInTheDocument();
  });
});
