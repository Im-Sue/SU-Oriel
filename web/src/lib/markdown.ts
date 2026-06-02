/**
 * 去除 YAML frontmatter 块，避免 MarkdownViewer 把 frontmatter 当作正文渲染。
 */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1] : content;
}
