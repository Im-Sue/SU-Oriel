import { useEffect } from "react";

import { useProjectStore } from "../stores/project-store.js";
import { useUIStore } from "../stores/ui-store.js";

export interface ProjectOnboardingGate {
  /** ccbRuntimeReady && knowledgeBaseReady 全绿才为 true */
  ready: boolean;
  /** 接入状态尚未加载完成(含首次未拉取);按未就绪门控,不 fail-open */
  loading: boolean;
  /** 加载失败信息;有 error 时按未就绪门控 */
  error: string | null;
  /** 弹出 onboarding-required 引导 modal(锚定当前 projectId) */
  requireInit: () => void;
}

/**
 * 项目接入门控派生 hook:从 project-store 的 onboardingByProject 单一数据源读状态,
 * 供 Sidebar 项目组锁定、onboarding-required modal 等消费。挂载 / projectId 变化时
 * 触发一次 ensureOnboarding(模块级 in-flight 去重 + 30s TTL)。
 *
 * 门控语义(不 fail-open):仅 ready=true 解锁;loading / error / 未就绪一律锁定。
 */
export function useProjectOnboardingGate(projectId: string | null): ProjectOnboardingGate {
  const entry = useProjectStore((state) => (projectId ? state.onboardingByProject[projectId] : undefined));
  const ensureOnboarding = useProjectStore((state) => state.ensureOnboarding);
  const openOnboardingRequired = useUIStore((state) => state.openOnboardingRequired);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    void ensureOnboarding(projectId);
  }, [projectId, ensureOnboarding]);

  const value = entry?.value ?? null;
  const ready = value?.ccbRuntimeReady === true && value?.knowledgeBaseReady === true;
  // 无 entry(尚未拉取)视为加载中 → 未就绪;不 fail-open。
  const loading = projectId ? (entry?.loading ?? true) : false;
  const error = entry?.error ?? null;

  return {
    ready,
    loading,
    error,
    requireInit: () => {
      if (projectId) {
        openOnboardingRequired(projectId);
      }
    }
  };
}
