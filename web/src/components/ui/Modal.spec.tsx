import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal.js";

describe("Modal", () => {
  it("does not render when closed", () => {
    render(
      <Modal open={false} title="标题" onClose={() => {}}>
        正文
      </Modal>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders title and content when open", () => {
    render(
      <Modal open title="标题" onClose={() => {}}>
        正文内容
      </Modal>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("标题")).toBeInTheDocument();
    expect(screen.getByText("正文内容")).toBeInTheDocument();
  });

  it("focuses the close button on open (does not assume content is focusable)", () => {
    render(
      <Modal open title="标题" onClose={() => {}}>
        正文
      </Modal>
    );
    expect(document.activeElement).toBe(screen.getByLabelText("关闭"));
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="标题" onClose={onClose}>
        正文
      </Modal>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on overlay click but not on content click", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="标题" onClose={onClose}>
        正文
      </Modal>
    );
    fireEvent.click(screen.getByText("正文"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps focus: Tab from last wraps to first and Shift+Tab from first wraps to last", () => {
    render(
      <Modal open title="标题" onClose={() => {}} footer={<button type="button">确认</button>}>
        正文
      </Modal>
    );
    const closeButton = screen.getByLabelText("关闭");
    const confirmButton = screen.getByText("确认");

    confirmButton.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmButton);
  });

  it("restores focus to the trigger when closed", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <Modal open title="标题" onClose={() => {}}>
        正文
      </Modal>
    );
    expect(document.activeElement).toBe(screen.getByLabelText("关闭"));

    rerender(
      <Modal open={false} title="标题" onClose={() => {}}>
        正文
      </Modal>
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("renders the reader size without error", () => {
    render(
      <Modal open title="标题" size="reader" onClose={() => {}}>
        长文正文
      </Modal>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
