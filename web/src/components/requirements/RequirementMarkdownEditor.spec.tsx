import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequirementMarkdownEditor } from "./RequirementMarkdownEditor.js";

let lastEasyMdeOptions: Record<string, unknown> | null = null;
let lastSetOption: ReturnType<typeof vi.fn> | null = null;

vi.mock("easymde", () => ({
  default: class MockEasyMDE {
    private currentValue: string;
    codemirror = {
      on: vi.fn(),
      off: vi.fn(),
      setOption: vi.fn()
    };

    constructor(options: Record<string, unknown>) {
      lastEasyMdeOptions = options;
      lastSetOption = this.codemirror.setOption;
      this.currentValue = String(options.initialValue ?? "");
    }

    value(next?: string) {
      if (next !== undefined) {
        this.currentValue = next;
      }
      return this.currentValue;
    }

    codemirrorRefresh() {}

    cleanup() {}
  }
}));

describe("RequirementMarkdownEditor", () => {
  beforeEach(() => {
    lastEasyMdeOptions = null;
    lastSetOption = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("configures EasyMDE image upload for paste and drop", async () => {
    const uploadImage = vi.fn().mockResolvedValue("./assets/requirements/tmp-1/a.png");
    render(
      <RequirementMarkdownEditor
        onChange={vi.fn()}
        onUploadImage={uploadImage}
        projectId="project-1"
        value="已有描述"
      />
    );

    await waitFor(() => expect(lastEasyMdeOptions).not.toBeNull());
    const imageUploadFunction = lastEasyMdeOptions?.imageUploadFunction as (
      file: File,
      onSuccess: (path: string) => void,
      onError: (message: string) => void
    ) => void;
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const file = new File(["png"], "paste.png", { type: "image/png" });

    imageUploadFunction(file, onSuccess, onError);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("./assets/requirements/tmp-1/a.png"));
    expect(onError).not.toHaveBeenCalled();
    expect(uploadImage).toHaveBeenCalledWith(file);
  });

  it("uploads image from file picker and appends markdown image syntax", async () => {
    const uploadImage = vi.fn().mockResolvedValue("./assets/requirements/tmp-1/picker.png");
    const onChange = vi.fn();
    render(
      <RequirementMarkdownEditor
        onChange={onChange}
        onUploadImage={uploadImage}
        projectId="project-1"
        value="已有描述"
      />
    );

    const file = new File(["png"], "picker.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("选择需求图片"), file);

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("已有描述\n\n![](./assets/requirements/tmp-1/picker.png)")
    );
  });

  it("maps disabled mode to CodeMirror readonly", async () => {
    const { rerender } = render(
      <RequirementMarkdownEditor
        disabled
        onChange={vi.fn()}
        onUploadImage={vi.fn()}
        projectId="project-1"
        value="只读描述"
      />
    );

    await waitFor(() => expect(lastSetOption).toHaveBeenCalledWith("readOnly", "nocursor"));

    rerender(
      <RequirementMarkdownEditor
        disabled={false}
        onChange={vi.fn()}
        onUploadImage={vi.fn()}
        projectId="project-1"
        value="只读描述"
      />
    );

    await waitFor(() => expect(lastSetOption).toHaveBeenCalledWith("readOnly", false));
  });
});
