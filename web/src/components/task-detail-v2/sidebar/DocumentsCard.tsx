import { SidebarCard } from "./TaskSidebar.js";
import styles from "./DocumentsCard.module.css";
import { getDocumentKindBadge } from "../../../lib/ui-mapping.js";
import type { TaskDetailView } from "../../../types/task.js";

interface DocumentsCardProps {
  documents: TaskDetailView["linkedDocuments"];
  onOpenDocument: (documentId: string) => void;
}

export function DocumentsCard({ documents, onOpenDocument }: DocumentsCardProps) {
  if (documents.length === 0) {
    return (
      <SidebarCard title="关联文档" icon="📁">
        <p className={styles.placeholder}>当前任务还没有关联文档</p>
      </SidebarCard>
    );
  }

  return (
    <SidebarCard title="关联文档" icon="📁" badge={`${documents.length}`}>
      <ul className={styles.list}>
        {documents.map((doc) => {
          const badge = getDocumentKindBadge(doc.kind);
          return (
            <li key={doc.id}>
              <button
                aria-label={`预览 ${doc.title}`}
                className={styles.item}
                onClick={() => onOpenDocument(doc.id)}
                type="button"
              >
                <span className={styles.title}>{doc.title}</span>
                <span className={styles.kindBadge} data-color={badge.color}>
                  {badge.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </SidebarCard>
  );
}
