# AI Tool Registry

Dev endpoint for Claude/Codex orchestration. The registry uses OpenAI function-calling style JSON Schema and can be adapted by Anthropic `tool_use` callers.

## Endpoints

- `GET /api/ai-tools/registry`
- `POST /api/ai-tools/invoke`

Invoke payload:

```json
{
  "tool_name": "fetch_task_state",
  "actor": "ai:claude",
  "input": {
    "taskId": "task-id"
  }
}
```

## Tools

- `derive_followup` writes through the derive-followup service.
- `fetch_task_state` reads task DB projection plus linked dev_task document frontmatter.

Drift and status repair paths were retired in Phase 3/4b; use `/ccb:su-reconcile` anchor dispatch instead. Writes still rely on the underlying service guards. Dev mode is unauthenticated; production should add bearer auth and per-tool write allowlisting before exposing beyond localhost.
