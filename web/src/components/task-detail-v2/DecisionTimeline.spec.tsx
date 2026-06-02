import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionTimeline } from "./DecisionTimeline.js";
import {
  fetchTaskTimeline,
  type TaskTimelineResult
} from "../../lib/timeline-api.js";

vi.mock("../../lib/timeline-api.js", () => ({
  fetchTaskTimeline: vi.fn()
}));

describe("DecisionTimeline", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps loading state before timeline data arrives", () => {
    vi.mocked(fetchTaskTimeline).mockReturnValue(new Promise(() => undefined));

    render(<DecisionTimeline taskId="task-1" />);

    expect(screen.getByText("加载时间线中…")).toBeInTheDocument();
  });

  it("renders empty state when timeline events are missing", async () => {
    vi.mocked(fetchTaskTimeline).mockResolvedValue({
      taskId: "task-1",
      hasMore: false
    } as TaskTimelineResult);

    render(<DecisionTimeline taskId="task-1" />);

    expect(await screen.findByText(/暂无关键事件/)).toBeInTheDocument();
  });
});
