function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortCanonical(item));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortCanonical(nested)])
    );
  }
  return value;
}

export function buildStructuredDispatchCommand(command: string, payload: Record<string, unknown>): string {
  return `/ccb:${command} --payload ${JSON.stringify(sortCanonical({ language: "中文", ...payload }))}`;
}

export function readStructuredDispatchPayload(command: string): Record<string, unknown> {
  const matched = command.match(/^\/ccb:[a-z][a-z0-9-]* --payload (.+)$/);
  if (!matched) return {};
  return JSON.parse(matched[1]) as Record<string, unknown>;
}

export function buildRequirementDispatchCommand(input: {
  projectId: string;
  requirementId: string;
  command: string;
  payload: Record<string, unknown>;
}): string {
  return buildStructuredDispatchCommand(input.command, {
    ...input.payload,
    project_id: input.projectId,
    requirement_id: input.requirementId,
    subject: "requirement"
  });
}

export function buildSubtaskDispatchCommand(input: {
  taskId: string;
  taskKey: string;
  command: string;
  payload: Record<string, unknown>;
}): string {
  return buildStructuredDispatchCommand(input.command, {
    ...input.payload,
    subject: "subtask",
    task_id: input.taskId,
    task_key: input.taskKey
  });
}
