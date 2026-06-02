export interface JsonSchema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema | { enum: string[]; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
}

export interface AiToolDefinition {
  name: "derive_followup" | "fetch_task_state";
  description: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  writes: boolean;
}

const taskIdProperty = {
  type: "string",
  description: "Console Task.id"
} as const;

export const AI_TOOL_REGISTRY: AiToolDefinition[] = [
  {
    name: "derive_followup",
    description: "从 source task 衍生 followup，并派发给 requirement task_breakdown。",
    writes: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["sourceTaskId", "type", "title"],
      properties: {
        sourceTaskId: taskIdProperty,
        type: {
          enum: ["subtask", "requirement", "decision"],
          description: "decision 当前仅返回 guard 错误"
        },
        title: {
          type: "string",
          description: "衍生项标题"
        },
        description: {
          type: "string",
          description: "衍生项说明"
        }
      }
    },
    output_schema: {
      type: "object",
      additionalProperties: true,
      properties: {
        kind: { type: "string" },
        dispatch: { type: "object", additionalProperties: true }
      }
    }
  },
  {
    name: "fetch_task_state",
    description: "读取 task 当前 DB 投影及关联 dev_task 文档 frontmatter，只读。",
    writes: false,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: taskIdProperty
      }
    },
    output_schema: {
      type: "object",
      additionalProperties: true,
      properties: {
        task: { type: "object", additionalProperties: true },
        documents: { type: "object", additionalProperties: true }
      }
    }
  }
];

export function getAiToolDefinition(name: string): AiToolDefinition | null {
  return AI_TOOL_REGISTRY.find((tool) => tool.name === name) ?? null;
}
