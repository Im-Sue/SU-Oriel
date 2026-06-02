/**
 * Phase C: Sprint / 迭代类型 (TAPD-inspired)
 */

import type { TaskView } from "./task.js";

export interface SprintView {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  status: "planning" | "active" | "closed" | "cancelled";
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  taskCount: number;
  completedCount: number;
  remainingPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface SprintDetailView extends SprintView {
  tasks: TaskView[];
}

export interface BurndownPointView {
  date: string;
  remainingPoints: number;
  totalPoints: number;
}

export interface BurndownView {
  sprintId: string;
  points: BurndownPointView[];
  totalTasks: number;
  completedTasks: number;
}

export interface CreateSprintInput {
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  capacity?: number;
}
