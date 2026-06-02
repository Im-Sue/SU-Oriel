import { create } from "zustand";

import { fetchDocumentDetail, fetchTaskDetail } from "../lib/console-api.js";
import type { DocumentDetailView } from "../types/document.js";
import type { TaskDetailView } from "../types/task.js";

interface DetailStore {
  documentDetail: DocumentDetailView | null;
  loadingDocumentDetail: boolean;
  taskDetail: TaskDetailView | null;
  loadingTaskDetail: boolean;
  loadDocumentDetail: (documentId: string) => Promise<void>;
  clearDocumentDetail: () => void;
  loadTaskDetail: (taskId: string) => Promise<void>;
  clearTaskDetail: () => void;
}

export const useDetailStore = create<DetailStore>()((set) => ({
  documentDetail: null,
  loadingDocumentDetail: false,
  taskDetail: null,
  loadingTaskDetail: false,
  loadDocumentDetail: async (documentId) => {
    set({ loadingDocumentDetail: true });
    try {
      const detail = await fetchDocumentDetail(documentId);
      set({ documentDetail: detail });
    } finally {
      set({ loadingDocumentDetail: false });
    }
  },
  clearDocumentDetail: () => {
    set({ documentDetail: null });
  },
  loadTaskDetail: async (taskId) => {
    set({ loadingTaskDetail: true });
    try {
      const detail = await fetchTaskDetail(taskId);
      set({ taskDetail: detail });
    } finally {
      set({ loadingTaskDetail: false });
    }
  },
  clearTaskDetail: () => {
    set({ taskDetail: null });
  }
}));
