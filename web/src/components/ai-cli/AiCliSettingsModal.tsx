import { useEffect, useMemo, useState } from "react";

import { useAiCliStore } from "../../stores/ai-cli-store.js";
import { useProjectStore } from "../../stores/project-store.js";
import { useUIStore } from "../../stores/ui-store.js";
import type {
  AiCliLaunchMode,
  AiCliSettingView,
  AiCliToolId
} from "../../types/ai-cli.js";
import { AI_CLI_TOOL_IDS } from "../../types/ai-cli.js";
import { Button } from "../ui/Button.js";
import { Input } from "../ui/Input.js";
import { Modal } from "../ui/Modal.js";
import styles from "./AiCliSettingsModal.module.css";

type Scope = "global" | "project";

interface ToolFormState {
  command: string;
  extraArgsText: string;
  defaultMode: AiCliLaunchMode | "inherit";
}

const TOOL_LABEL: Record<AiCliToolId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI"
};

function buildEmptyForm(): ToolFormState {
  return { command: "", extraArgsText: "", defaultMode: "inherit" };
}

function recordToForm(record: AiCliSettingView | undefined): ToolFormState {
  if (!record) {
    return buildEmptyForm();
  }
  return {
    command: record.command ?? "",
    extraArgsText: record.extraArgs.join(" "),
    defaultMode: record.defaultMode ?? "inherit"
  };
}

function parseExtraArgs(text: string): string[] {
  return text
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function AiCliSettingsModal() {
  const modalOpen = useUIStore((state) => state.modalOpen);
  const modalType = useUIStore((state) => state.modalType);
  const closeModal = useUIStore((state) => state.closeModal);
  const addToast = useUIStore((state) => state.addToast);
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);

  const tools = useAiCliStore((state) => state.tools);
  const settings = useAiCliStore((state) => state.settings);
  const loadSettings = useAiCliStore((state) => state.loadSettings);
  const loadTools = useAiCliStore((state) => state.loadTools);
  const saveSetting = useAiCliStore((state) => state.saveSetting);
  const removeSetting = useAiCliStore((state) => state.removeSetting);

  const [scope, setScope] = useState<Scope>("global");
  const [forms, setForms] = useState<Record<AiCliToolId, ToolFormState>>({
    claude: buildEmptyForm(),
    codex: buildEmptyForm(),
    gemini: buildEmptyForm()
  });
  const [savingTool, setSavingTool] = useState<AiCliToolId | null>(null);

  const open = modalOpen && modalType === "ai-cli-settings";
  const projectName = useMemo(
    () => projects.find((project) => project.id === selectedProjectId)?.name ?? null,
    [projects, selectedProjectId]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadSettings();
    void loadTools(selectedProjectId);
  }, [open, loadSettings, loadTools, selectedProjectId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const next = { ...forms };
    let changed = false;
    for (const toolId of AI_CLI_TOOL_IDS) {
      const projectIdForScope = scope === "project" ? selectedProjectId : null;
      const record = settings.find(
        (item) => item.scope === scope && item.toolId === toolId && item.projectId === projectIdForScope
      );
      const formValue = recordToForm(record);
      if (
        next[toolId].command !== formValue.command ||
        next[toolId].extraArgsText !== formValue.extraArgsText ||
        next[toolId].defaultMode !== formValue.defaultMode
      ) {
        next[toolId] = formValue;
        changed = true;
      }
    }
    if (changed) {
      setForms(next);
    }
    // 切换 scope 或 project 时刷新表单值；故依赖 settings/scope/selectedProjectId 即可
  }, [open, scope, selectedProjectId, settings]);

  const handleClose = () => {
    closeModal();
  };

  const handleSave = async (toolId: AiCliToolId) => {
    if (scope === "project" && !selectedProjectId) {
      addToast("error", "尚未选择项目，无法保存项目级设置");
      return;
    }

    const form = forms[toolId];
    setSavingTool(toolId);
    try {
      await saveSetting({
        scope,
        projectId: scope === "project" ? selectedProjectId : null,
        toolId,
        command: form.command.trim().length > 0 ? form.command.trim() : null,
        extraArgs: parseExtraArgs(form.extraArgsText),
        defaultMode: form.defaultMode === "inherit" ? null : form.defaultMode
      });
      addToast("success", `已保存 ${TOOL_LABEL[toolId]} 的 ${scope === "global" ? "全局" : "项目级"}设置`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "保存设置失败");
    } finally {
      setSavingTool(null);
    }
  };

  const handleReset = async (toolId: AiCliToolId) => {
    if (scope === "project" && !selectedProjectId) {
      addToast("error", "尚未选择项目，无法删除项目级设置");
      return;
    }

    setSavingTool(toolId);
    try {
      await removeSetting({
        scope,
        projectId: scope === "project" ? selectedProjectId : null,
        toolId
      });
      addToast("success", `已重置 ${TOOL_LABEL[toolId]} 的设置`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "重置设置失败");
    } finally {
      setSavingTool(null);
    }
  };

  return (
    <Modal
      footer={<Button onClick={handleClose} variant="secondary">关闭</Button>}
      onClose={handleClose}
      open={open}
      title="AI CLI 设置"
    >
      <div className={styles.body}>
        <div className={styles.scopeRow}>
          <span className={styles.fieldLabel}>设置作用域</span>
          <div className={styles.scopeOptions}>
            <button
              className={styles.scopeButton}
              data-active={String(scope === "global")}
              onClick={() => setScope("global")}
              type="button"
            >
              全局
            </button>
            <button
              className={styles.scopeButton}
              data-active={String(scope === "project")}
              disabled={!selectedProjectId}
              onClick={() => setScope("project")}
              type="button"
            >
              当前项目{projectName ? `（${projectName}）` : ""}
            </button>
          </div>
          <div className={styles.scopeNotice}>
            优先级：项目级覆盖 → 全局覆盖 → 内置默认。空命令字段表示走 PATH 自动探测。
          </div>
        </div>

        <div className={styles.toolList}>
          {AI_CLI_TOOL_IDS.map((toolId) => {
            const tool = tools.find((item) => item.id === toolId);
            const form = forms[toolId];
            const saving = savingTool === toolId;

            return (
              <div className={styles.toolCard} key={toolId}>
                <div className={styles.toolHead}>
                  <div className={styles.toolTitle}>{TOOL_LABEL[toolId]}</div>
                  <div className={styles.toolStatus} data-available={String(tool?.available ?? false)}>
                    {tool
                      ? tool.available
                        ? `已检测：${tool.resolvedPath ?? tool.command}`
                        : `未检测到：${tool.command}`
                      : "加载中"}
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>可执行命令或绝对路径</span>
                  <Input
                    onChange={(event) =>
                      setForms((state) => ({ ...state, [toolId]: { ...state[toolId], command: event.target.value } }))
                    }
                    placeholder={`例如：${toolId} 或 C:\\bin\\${toolId}.cmd（留空走 PATH）`}
                    value={form.command}
                  />
                </div>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>启动参数（用空格分隔）</span>
                  <Input
                    onChange={(event) =>
                      setForms((state) => ({
                        ...state,
                        [toolId]: { ...state[toolId], extraArgsText: event.target.value }
                      }))
                    }
                    placeholder="例如：--model opus-4-7"
                    value={form.extraArgsText}
                  />
                  <span className={styles.fieldHint}>留空表示无额外参数</span>
                </div>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>默认启动模式</span>
                  <div className={styles.modeRow}>
                    {(["inherit", "external", "embedded"] as const).map((value) => (
                      <button
                        className={styles.modeButton}
                        data-active={String(form.defaultMode === value)}
                        key={value}
                        onClick={() =>
                          setForms((state) => ({ ...state, [toolId]: { ...state[toolId], defaultMode: value } }))
                        }
                        type="button"
                      >
                        {value === "inherit" ? "跟随上层" : value === "external" ? "外部窗口" : "页内嵌入"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.actionsRow}>
                  <Button onClick={() => void handleReset(toolId)} size="sm" variant="ghost">
                    重置为默认
                  </Button>
                  <Button loading={saving} onClick={() => void handleSave(toolId)} size="sm">
                    保存
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
