import { create } from "zustand";

const SIDEBAR_COLLAPSED_KEY = "ccb-console:sidebar-collapsed";

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(value: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

interface ToastItem {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface UIStore {
  sidebarCollapsed: boolean;
  slidePanelOpen: boolean;
  slidePanelContent: { type: "task"; taskId: string } | null;
  modalOpen: boolean;
  modalType: "create-project" | "create-requirement" | "ai-cli-settings" | null;
  toasts: ToastItem[];
  anchorResetEpochs: Record<string, number>;
  toggleSidebar: () => void;
  openTaskPanel: (taskId: string) => void;
  closeSlidePanel: () => void;
  openModal: (type: UIStore["modalType"]) => void;
  closeModal: () => void;
  addToast: (type: ToastItem["type"], message: string) => void;
  removeToast: (id: string) => void;
  bumpAnchorResetEpoch: (taskId: string) => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  sidebarCollapsed: loadSidebarCollapsed(),
  slidePanelOpen: false,
  slidePanelContent: null,
  modalOpen: false,
  modalType: null,
  toasts: [],
  anchorResetEpochs: {},
  toggleSidebar: () => {
    set((state) => {
      const next = !state.sidebarCollapsed;
      saveSidebarCollapsed(next);
      return { sidebarCollapsed: next };
    });
  },
  openTaskPanel: (taskId) => {
    set({
      slidePanelOpen: true,
      slidePanelContent: { type: "task", taskId }
    });
  },
  closeSlidePanel: () => {
    set({
      slidePanelOpen: false,
      slidePanelContent: null
    });
  },
  openModal: (type) => {
    set({
      modalOpen: true,
      modalType: type
    });
  },
  closeModal: () => {
    set({
      modalOpen: false,
      modalType: null
    });
  },
  addToast: (type, message) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }]
    }));
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }));
  },
  bumpAnchorResetEpoch: (taskId) => {
    set((state) => ({
      anchorResetEpochs: {
        ...state.anchorResetEpochs,
        [taskId]: (state.anchorResetEpochs[taskId] ?? 0) + 1
      }
    }));
  }
}));
