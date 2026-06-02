import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import styles from "./MarkdownBlock.module.css";

interface MarkdownBlockProps {
  source: string;
  compact?: boolean;
}

export function MarkdownBlock({ source, compact = false }: MarkdownBlockProps) {
  if (!source || !source.trim()) {
    return <div className={styles.empty}>（无内容）</div>;
  }

  return (
    <div className={`${styles.root} ${compact ? styles.compact : ""}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
