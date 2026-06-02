import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import styles from "./MarkdownViewer.module.css";

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer(props: MarkdownViewerProps) {
  return (
    <div className={styles.viewer}>
      <Markdown
        components={{
          code(componentProps) {
            // 额外保留一份纯文本代码内容，避免高亮后的嵌套 span 影响测试和检索。
            const codeText = flattenText(componentProps.children).replace(/\n$/, "");
            return (
              <code className={componentProps.className} data-raw-text={codeText}>
                {codeText}
              </code>
            );
          }
        }}
        rehypePlugins={[rehypeHighlight]}
        remarkPlugins={[remarkGfm]}
      >
        {props.content}
      </Markdown>
    </div>
  );
}

function flattenText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map((item) => flattenText(item)).join("");
  }

  if (isValidElement(children)) {
    return flattenText((children as ReactElement<{ children?: ReactNode }>).props.children ?? "");
  }

  return "";
}
