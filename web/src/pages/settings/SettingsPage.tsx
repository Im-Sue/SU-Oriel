import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./SettingsPage.module.css";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Button } from "../../components/ui/Button.js";
import { Input, Textarea } from "../../components/ui/Input.js";
import { fetchProjectSettings, updateProjectSettings } from "../../lib/console-api.js";
import { useProjectStore } from "../../stores/project-store.js";
import type { ProjectSettingsPayload, ProjectSettingsView } from "../../types/settings.js";

interface SettingsFormState {
  scanEnabled: boolean;
  scanPaths: string;
  scanExcludePatterns: string;
  strictFrontmatter: boolean;
  allowedCategories: string;
  docsRoot: string;
  kernelRef: string;
}

const emptyForm: SettingsFormState = {
  scanEnabled: true,
  scanPaths: "docs",
  scanExcludePatterns: "node_modules\n.git",
  strictFrontmatter: true,
  allowedCategories: "01\n02\n03\n04\n05",
  docsRoot: "docs",
  // Vestigial display setting: Console does not read kernel files from this path.
  kernelRef: "references/kernel"
};

function listToText(value: string[]): string {
  return value.join("\n");
}

function textToList(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toForm(settings: ProjectSettingsView): SettingsFormState {
  return {
    scanEnabled: settings.scan_strategy.enabled,
    scanPaths: listToText(settings.scan_strategy.paths),
    scanExcludePatterns: listToText(settings.scan_strategy.exclude_patterns),
    strictFrontmatter: settings.parsing_rules.strict_frontmatter,
    allowedCategories: listToText(settings.parsing_rules.allowed_categories),
    docsRoot: settings.path_config.docs_root,
    kernelRef: settings.path_config.kernel_ref
  };
}

function toPayload(form: SettingsFormState): ProjectSettingsPayload {
  return {
    scan_strategy: {
      enabled: form.scanEnabled,
      paths: textToList(form.scanPaths),
      exclude_patterns: textToList(form.scanExcludePatterns)
    },
    parsing_rules: {
      strict_frontmatter: form.strictFrontmatter,
      allowed_categories: textToList(form.allowedCategories)
    },
    path_config: {
      docs_root: form.docsRoot.trim(),
      kernel_ref: form.kernelRef.trim()
    }
  };
}

function validatePayload(payload: ProjectSettingsPayload): string | null {
  if (!payload.path_config.docs_root || !payload.path_config.kernel_ref) {
    return "路径配置不能为空";
  }
  if (payload.scan_strategy.paths.length === 0) {
    return "扫描路径不能为空";
  }
  if (payload.parsing_rules.allowed_categories.length === 0) {
    return "允许分类不能为空";
  }
  return null;
}

export function SettingsPage() {
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const projects = useProjectStore((state) => state.projects);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const [form, setForm] = useState<SettingsFormState>(emptyForm);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const settings = await fetchProjectSettings(selectedProjectId);
      setForm(toForm(settings));
      setLastUpdatedAt(settings.updated_at);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载项目设置失败");
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const payload = useMemo(() => toPayload(form), [form]);

  async function handleSubmit() {
    if (!selectedProjectId) {
      setError("当前没有选中的项目");
      return;
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      setError(validationError);
      setNotice(null);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateProjectSettings(selectedProjectId, payload);
      setForm(toForm(updated));
      setLastUpdatedAt(updated.updated_at);
      setNotice("设置已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存项目设置失败");
    } finally {
      setSaving(false);
    }
  }

  if (!selectedProjectId) {
    return <EmptyState description="先选择或创建项目，再配置项目级扫描和解析规则。" icon="⚙" title="未选择项目" />;
  }

  return (
    <div className={styles.page}>
      <section className={styles.headerBand}>
        <div>
          <div className={styles.eyebrow}>项目设置</div>
          <h2 className={styles.title}>{selectedProject?.name ?? "当前项目"}</h2>
          <p className={styles.description}>维护文件自动扫描、解析规则和路径配置。</p>
        </div>
        <div className={styles.meta}>{lastUpdatedAt ? `更新于 ${new Date(lastUpdatedAt).toLocaleString()}` : "尚未保存"}</div>
      </section>

      {error ? (
        <div className={styles.alert} role="alert">
          <span>{error}</span>
          <button className={styles.inlineButton} onClick={() => void loadSettings()} type="button">
            重试
          </button>
        </div>
      ) : null}

      {notice ? <div className={styles.success}>{notice}</div> : null}

      <div className={styles.formGrid} aria-busy={loading}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>scan_strategy</h3>
              <p className={styles.panelDescription}>控制文件变更是否自动触发扫描，以及需要纳入或排除的路径。</p>
            </div>
            <label className={styles.switchRow}>
              <input
                checked={form.scanEnabled}
                onChange={(event) => setForm((state) => ({ ...state, scanEnabled: event.target.checked }))}
                type="checkbox"
              />
              <span>文件自动扫描</span>
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>扫描路径 scan_strategy.paths</span>
            <Textarea
              onChange={(event) => setForm((state) => ({ ...state, scanPaths: event.target.value }))}
              rows={4}
              value={form.scanPaths}
            />
            <span className={styles.fieldHint}>每行一个路径，也支持逗号分隔。</span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>排除规则 scan_strategy.exclude_patterns</span>
            <Textarea
              onChange={(event) => setForm((state) => ({ ...state, scanExcludePatterns: event.target.value }))}
              rows={4}
              value={form.scanExcludePatterns}
            />
          </label>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>parsing_rules</h3>
              <p className={styles.panelDescription}>约束文档解析的 frontmatter 和目录分类范围。</p>
            </div>
            <label className={styles.switchRow}>
              <input
                checked={form.strictFrontmatter}
                onChange={(event) => setForm((state) => ({ ...state, strictFrontmatter: event.target.checked }))}
                type="checkbox"
              />
              <span>严格 frontmatter</span>
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>允许分类 parsing_rules.allowed_categories</span>
            <Textarea
              onChange={(event) => setForm((state) => ({ ...state, allowedCategories: event.target.value }))}
              rows={5}
              value={form.allowedCategories}
            />
            <span className={styles.fieldHint}>例如 01、02、03、04、05。</span>
          </label>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>path_config</h3>
              <p className={styles.panelDescription}>声明项目文档根目录和 kernel reference 路径。</p>
            </div>
          </div>
          <div className={styles.inlineFields}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>文档根目录 path_config.docs_root</span>
              <Input
                onChange={(event) => setForm((state) => ({ ...state, docsRoot: event.target.value }))}
                value={form.docsRoot}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Kernel 引用路径 path_config.kernel_ref</span>
              <Input
                onChange={(event) => setForm((state) => ({ ...state, kernelRef: event.target.value }))}
                value={form.kernelRef}
              />
            </label>
          </div>
        </section>
      </div>

      <div className={styles.actions}>
        <Button disabled={loading} loading={saving} onClick={() => void handleSubmit()}>
          保存设置
        </Button>
      </div>
    </div>
  );
}
