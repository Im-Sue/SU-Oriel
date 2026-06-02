import { useParams } from "react-router";

import { TaskDetailFullPage } from "./TaskDetailFullPage.js";
import { TasksBoardRoute } from "./TasksBoardView.js";

export function TasksPage() {
  const { taskId } = useParams();
  return taskId ? <TaskDetailFullPage taskId={taskId} /> : <TasksBoardRoute />;
}
