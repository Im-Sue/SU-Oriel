import { describe, expect, it } from "vitest";

import { rewriteRequirementAssetUrls } from "./requirement-asset-url.js";

describe("rewriteRequirementAssetUrls", () => {
  it("leaves markdown unchanged when projectId is empty", () => {
    const markdown = "![](./assets/requirements/tmp-1/image.png)";

    expect(rewriteRequirementAssetUrls(markdown, "")).toBe(markdown);
  });

  it("leaves unmatched asset paths unchanged", () => {
    const markdown = [
      "![not relative](/assets/requirements/tmp-1/image.png)",
      "[link](./assets/requirements/tmp-1/image.png)",
      "![](./assets/tasks/tmp-1/image.png)"
    ].join("\n");

    expect(rewriteRequirementAssetUrls(markdown, "project-1")).toBe(markdown);
  });

  it("rewrites uploaded requirement image paths to project asset URLs", () => {
    const markdown = "Intro\n\n![diagram](./assets/requirements/tmp-1/diagram.png)";

    expect(rewriteRequirementAssetUrls(markdown, "project-1")).toBe(
      "Intro\n\n![diagram](/api/projects/project-1/requirements/tmp-1/assets/diagram.png)"
    );
  });
});
