import { describe, expect, it } from "vitest";

import { stripFrontmatter } from "./markdown.js";

describe("stripFrontmatter", () => {
  it("removes YAML frontmatter from markdown content", () => {
    const content = "---\ntitle: Example\nstatus: active\n---\n# Body\n\nText";

    expect(stripFrontmatter(content)).toBe("# Body\n\nText");
  });

  it("leaves content without frontmatter unchanged", () => {
    const content = "# Body\n\n---\nnot frontmatter";

    expect(stripFrontmatter(content)).toBe(content);
  });

  it("removes YAML frontmatter with CRLF line endings", () => {
    const content = "---\r\ntitle: Example\r\n---\r\n# Body\r\nText";

    expect(stripFrontmatter(content)).toBe("# Body\r\nText");
  });
});
