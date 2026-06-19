import type { ProjectView } from "../types/project.js";

/**
 * 项目过滤纯函数：按项目名或本地路径做大小写不敏感匹配，keyword 前后空白忽略。
 * 顶部项目条「更多」弹层与侧栏项目下拉共用同一规则，避免两处实现漂移。
 */
export function filterProjects(projects: ProjectView[], keyword: string): ProjectView[] {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return projects;
  }
  return projects.filter(
    (project) =>
      project.name.toLowerCase().includes(normalized) || project.localPath.toLowerCase().includes(normalized)
  );
}

export interface VisibleProjectSplit {
  visible: ProjectView[];
  overflow: ProjectView[];
}

/**
 * 计算顶部项目条的可见集合：**当前选中项目恒置顶**（排第一张卡），其余保持原序；
 * 超出 maxVisible 的进溢出。因为选中项永远在第一位，所以天然恒可见、不重复、不占溢出计数。
 */
export function computeVisibleProjects(
  projects: ProjectView[],
  selectedProjectId: string | null,
  maxVisible: number
): VisibleProjectSplit {
  let ordered = projects;
  if (selectedProjectId != null) {
    const index = projects.findIndex((project) => project.id === selectedProjectId);
    if (index > 0) {
      ordered = [projects[index], ...projects.slice(0, index), ...projects.slice(index + 1)];
    }
  }

  if (maxVisible <= 0 || ordered.length <= maxVisible) {
    return { visible: ordered, overflow: [] };
  }
  return { visible: ordered.slice(0, maxVisible), overflow: ordered.slice(maxVisible) };
}

export type ProjectStatusTone = "error" | "busy" | "idle";

/**
 * 项目状态点色调：仅在「有事」时返回（失败/进行中/未初始化），健康项目返回 null（不显点）。
 */
export function projectStatusTone(project: ProjectView): ProjectStatusTone | null {
  if (project.initStatus === "error" || project.syncStatus === "failed") {
    return "error";
  }
  if (project.syncStatus === "running" || project.syncStatus === "scanning") {
    return "busy";
  }
  if (project.initStatus === "not_initialized") {
    return "idle";
  }
  return null;
}
