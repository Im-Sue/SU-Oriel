import { useState } from "react";

import { SidebarCard } from "./TaskSidebar.js";
import styles from "./DerivedFollowupsCard.module.css";
import { DeriveFollowupDialog } from "../DeriveFollowupDialog.js";
import { deriveFollowup, type DeriveFollowupType } from "../../../lib/console-api.js";
import { useProjectStore } from "../../../stores/project-store.js";
import { useUIStore } from "../../../stores/ui-store.js";

interface DerivedFollowupsCardProps {
  taskId: string;
  sourceRequirementId: string | null;
}

export function DerivedFollowupsCard({ taskId, sourceRequirementId }: DerivedFollowupsCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const loadProjectData = useProjectStore((state) => state.loadProjectData);
  const addToast = useUIStore((state) => state.addToast);

  const handleConfirm = async (payload: { type: DeriveFollowupType; title: string; description: string }) => {
    setSubmitting(true);
    try {
      await deriveFollowup(taskId, {
        type: payload.type,
        title: payload.title,
        description: payload.description || undefined
      });
      addToast("success", `已派出衍生 followup（已排队 /ccb:su-flow）：${payload.title}`);
      setDialogOpen(false);
      if (selectedProjectId) {
        await loadProjectData(selectedProjectId);
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "创建衍生失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SidebarCard title="衍生 followup" icon="↳">
        <div className={styles.actionRow}>
          <button
            aria-label="创建衍生 followup"
            className={styles.deriveButton}
            onClick={() => setDialogOpen(true)}
            type="button"
          >
            + 衍生
          </button>
        </div>
        <p className={styles.placeholder}>
          派生的 followup 会作为本需求的新子任务派出（/ccb:su-flow），在任务看板可见
        </p>
      </SidebarCard>
      <DeriveFollowupDialog
        onClose={() => setDialogOpen(false)}
        onConfirm={(payload) => void handleConfirm(payload)}
        open={dialogOpen}
        sourceHasRequirement={Boolean(sourceRequirementId)}
        submitting={submitting}
      />
    </>
  );
}
