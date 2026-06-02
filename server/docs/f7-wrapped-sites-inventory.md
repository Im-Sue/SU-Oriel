# F7 Wrapped Sites Inventory

Scope: F7-C slice 4 / C1. Source command:

```bash
rg "primitiveExecutor\.run" --type ts
```

Raw `rg` returned 96 TypeScript hits. This report inventories the 84 production and maintenance call sites under `apps/ccb-console/server/src`, excluding `src/tests/**` and `*.spec.ts` fixture calls. `scripts/lint-schema-ownership.ts` contains a string literal only and is not a wrapped mutation site.

Audit behavior uses F7-B executor semantics:

- `cacheable`: non-null `idempotencyKey` and primitive is not in the executor non-cacheable allowlist.
- `non-cacheable`: primitive is explicitly excluded from idempotency replay by `primitive-wrapper.ts`.
- `fall-back / audit-only`: key is null or intentionally time-based; it creates audit rows but does not provide replay semantics.

## Review Summary

- Inventory count: 84 production/maintenance sites.
- No hash-collision style key reuse found in F2-S1/S2/S3 / F4 focus areas (`cancel_*`, `revert_*`, `lock_*`, `rollback_*`, `rollup_*`, `create_replan_subtask`, `backfill_*`).
- Non-cacheable primitives are limited to the executor allowlist: `append_event_journal`, `consume_review_intent`, `create_replan_subtask`, `record_transition_dry_run`, `revert_epic_status_to_planning`.
- Observed audit-only sites to keep visible for later review, not fixed in this slice: `create_sync_job` uses `null`, ad-hoc UI `create_review_intent` uses `null`, and `record_hook_audit_log` uses `Date.now()`.

## Inventory

| Site | Primitive | idempotencyKey template | Audit behavior |
| --- | --- | --- | --- |
| src/indexer/project-indexer.ts:330 | `mark_project_scan_initialized` | ``${projectId}:mark_project_scan_initialized`` | cacheable |
| src/indexer/project-indexer.ts:360 | `mark_project_scan_failed` | ``${projectId}:mark_project_scan_failed`` | cacheable |
| src/indexer/project-indexer.ts:384 | `apply_task_projection_diff` | ``${projectId}:apply_task_projection_diff:upsert:${task.taskKey}:${task.stateHashProjection ?? "no-state"}`` | cacheable |
| src/indexer/project-indexer.ts:487 | `merge_task_identity_assignment` | ``${projectId}:merge_task_identity_assignment:${item.sourceTaskKey}:${item.survivorTaskKey}:${item.stateDocumentId}`` | cacheable |
| src/indexer/project-indexer.ts:746 | `cleanup_stale_task_projections` | ``${projectId}:cleanup_stale_task_projections:${retainedTaskKeys.length === 0 ? "none" : retainedTaskKeys.join(",")}`` | cacheable |
| src/indexer/project-indexer.ts:879 | `apply_requirement_diff` | ``${projectId}:apply_requirement_diff:create:requirement_only:${id}`` | cacheable |
| src/indexer/project-indexer.ts:1095 | `apply_requirement_diff` | ``${projectId}:apply_requirement_diff:create:${input.outputMode}:${slugify(input.title) \|\| "untitled"}`` | cacheable |
| src/indexer/project-indexer.ts:1123 | `apply_requirement_diff` | ``${requirementId}:apply_requirement_diff:update_generated_task:${generatedTaskId ?? "none"}`` | cacheable |
| src/indexer/project-indexer.ts:1200 | `materialize_requirement_cache` | ``${requirement.id}:materialize_requirement_cache:${task.id}`` | cacheable |
| src/indexer/project-indexer.ts:1231 | `materialize_requirement_carrier` | ``${requirementId}:materialize_requirement_carrier:${taskId}`` | cacheable |
| src/indexer/project-indexer.ts:1260 | `materialize_requirement_task` | ``${projectId}:materialize_requirement_task:${requirementId}:${taskKey}`` | cacheable |
| src/indexer/project-indexer.ts:1290 | `create_sync_job` | `null` | fall-back / audit-only (null key) |
| src/indexer/project-indexer.ts:1312 | `finish_sync_job` | ``${syncJobId}:finish_sync_job:${status}`` | cacheable |
| src/indexer/project-indexer.ts:1714 | `write_generated_doc` | ``write_generated_doc:${filePath}`` | cacheable |
| src/maintenance/backfill-requirement-generated-task-id.ts:228 | `backfill_requirement_generated_task_id` | ``${item.requirementId}:backfill_requirement_generated_task_id:${item.taskId}`` | cacheable |
| src/maintenance/backfill-requirement-generated-task-id.ts:284 | `cleanup_subtask_materialization_state` | ``${item.taskId}:cleanup_subtask_materialization_state`` | cacheable |
| src/maintenance/backfill-requirement-generated-task-id.ts:416 | `backfill_requirement_materialization_carrier` | ``${item.requirementId}:backfill_requirement_materialization_carrier:${item.taskId}`` | cacheable |
| src/maintenance/backfill-requirement-generated-task-id.ts:537 | `backfill_requirement_materialization_multi_carrier` | ``${item.requirementId}:backfill_requirement_materialization_multi_carrier:${item.taskId}`` | cacheable |
| src/maintenance/backfill-requirement-generated-task-id.ts:723 | `backfill_requirement_generated_task_id` | ``${requirementId}:backfill_requirement_generated_task_id:${taskId}`` | cacheable |
| src/modules/breakdown-draft/materialize.service.ts:239 | `lock_epic_materialization` | ``${idempotencyKey}:cas-lock`` | cacheable |
| src/modules/breakdown-draft/materialize.service.ts:290 | `materialize_as_epic` | `idempotencyKey` | cacheable |
| src/modules/breakdown-draft/materialize.service.ts:573 | `rollback_epic_materialization` | ``${idempotencyKey}:cas-rollback`` | cacheable |
| src/modules/checkpoints/checkpoints.service.ts:45 | `create_task_checkpoint` | ``${input.taskId}:checkpoint:${input.transitionId}`` | cacheable |
| src/modules/checkpoints/checkpoints.service.ts:76 | `mark_task_checkpoint_snapshot_written` | ``${pending.checkpointId}:snapshot-written`` | cacheable |
| src/modules/consult-requests/consult-requests.service.ts:57 | `submit_consult_request` | ``${task.id}:consult_request:${input.nodeId}:${input.targetAgent}`` | cacheable |
| src/modules/consult-requests/consult-requests.service.ts:80 | `cancel_consult_request` | ``${id}:cancel_consult_request`` | cacheable |
| src/modules/events/event-journal.service.ts:112 | `append_event_journal` | `input.idempotency_key ?? input.event_id` | non-cacheable (executor allowlist) |
| src/modules/events/event-journal.service.ts:203 | `append_event_journal` | `parsed.idempotency_key ?? parsed.event_id` | non-cacheable (executor allowlist) |
| src/modules/executor-profile/executor-profile.service.ts:98 | `upsert_executor_profile` | ``${projectId}:executor_profile:${profileId}`` | cacheable |
| src/modules/hooks/hooks.service.ts:23 | `record_hook_audit_log` | ``${PRE_TASK_CREATE_HOOK}:${Date.now()}`` | fall-back / audit-only (time key) |
| src/modules/kernel/apply.routes.ts:262 | `input.primitive` | `idempotencyKey` | cacheable |
| src/modules/kernel/apply.routes.ts:342 | `create_review_intent` | ``${context.applyId}:create_review_intent:${task.id}`` | cacheable |
| src/modules/kernel/apply.routes.ts:412 | `dispatch_task` | `idempotencyKey` | cacheable |
| src/modules/kernel/apply.routes.ts:462 | `dispatch_task` | `idempotencyKey` | cacheable |
| src/modules/kernel/apply.routes.ts:540 | `cancel_review_intent` | ``${context.applyId}:cancel_review_intent:${intent.id}`` | cacheable |
| src/modules/primitive/consult-codex.service.ts:98 | `consult_codex` | <code>input.consultRequestId ?? `${input.taskId}:consult_codex:${input.nodeId}`</code> | cacheable |
| src/modules/requirement/requirement-status-rollup.ts:30 | `cancel_requirement_status` | ``${requirementId}:cancel_requirement_status`` | cacheable |
| src/modules/requirement/requirement-status-rollup.ts:46 | `defer_requirement_status` | ``${requirementId}:defer_requirement_status`` | cacheable |
| src/modules/requirement/requirement-status-rollup.ts:132 | `rollup_requirement_status` | ``${requirementId}:rollup_requirement_status`` | cacheable |
| src/modules/scheduler/consult-request-adapter.ts:60 | `reject_consult_request` | ``${row.id}:reject_consult_request`` | cacheable |
| src/modules/scheduler/cursor.service.ts:82 | `record_scheduler_cursor_progress` | ``${input.taskId}:scheduler_cursor_progress:${input.eventId}`` | cacheable |
| src/modules/scheduler/cursor.service.ts:109 | `record_scheduler_cursor_pause` | ``${input.taskId}:scheduler_cursor_pause:${input.pauseReason}`` | cacheable |
| src/modules/scheduler/cursor.service.ts:137 | `clear_scheduler_cursor_pause` | ``${clearInput.taskId}:scheduler_cursor_clear_pause:${clearInput.advanceTo?.eventId ?? "no-advance"}`` | cacheable |
| src/modules/scheduler/lock.service.ts:117 | `heartbeat_scheduler_lock` | ``${this.lockId}:${holderId}:heartbeat:${now.toISOString()}`` | cacheable |
| src/modules/scheduler/scheduler.service.ts:641 | `activate_scheduler_branch_set` | ``${input.taskId}:activate_branch_set:${activeBranchSetId}`` | cacheable |
| src/modules/settings/settings.service.ts:81 | `upsert_project_settings` | ``${projectId}:project_settings`` | cacheable |
| src/modules/sprint/sprint.routes.ts:113 | `create_sprint` | ``${projectId}:create_sprint:${body.name.trim()}`` | cacheable |
| src/modules/sprint/sprint.routes.ts:161 | `update_sprint` | ``${sprintId}:update_sprint`` | cacheable |
| src/modules/sprint/sprint.routes.ts:193 | `assign_task_to_sprint` | ``${taskId}:assign_sprint:${sprintId}`` | cacheable |
| src/modules/sprint/sprint.routes.ts:209 | `remove_task_from_sprint` | ``${taskId}:remove_sprint`` | cacheable |
| src/modules/task/epic-status-rollup.ts:40 | `cancel_epic_status` | ``${epicId}:cancel_epic_status`` | cacheable |
| src/modules/task/epic-status-rollup.ts:73 | `revert_epic_status_to_planning` | ``${epicId}:revert_epic_status_to_planning`` | non-cacheable (executor allowlist) |
| src/modules/task/epic-status-rollup.ts:158 | `rollup_epic_status` | ``${epicId}:rollup_epic_status`` | cacheable |
| src/modules/task/state-projection.ts:156 | `refresh_task_projection` | ``${task.id}:refresh_task_projection:${snapshot.hash}`` | cacheable |
| src/modules/task/task.routes.ts:285 | `update_task_metadata` | ``${taskId}:update_task_metadata`` | cacheable |
| src/modules/task/task.routes.ts:773 | `create_review_intent` | `null` | fall-back / audit-only (null key) |
| src/modules/task/task.routes.ts:839 | `consume_review_intent` | ``${intentId}:consume_review_intent:failed`` | non-cacheable (executor allowlist) |
| src/modules/task/task.routes.ts:866 | `consume_review_intent` | ``${intentId}:consume_review_intent:considered`` | non-cacheable (executor allowlist) |
| src/modules/task/task.routes.ts:908 | `cancel_review_intent` | ``${intentId}:cancel_review_intent`` | cacheable |
| src/modules/task-run/worktree.service.ts:107 | `cleanup_taskrun_worktree` | ``${taskRun.id}:cleanup_taskrun_worktree:pending`` | cacheable |
| src/modules/task-run/worktree.service.ts:172 | `cleanup_taskrun_worktree` | ``${taskRun.id}:cleanup_taskrun_worktree:cleaned`` | cacheable |
| src/modules/transitions/transition-consumption.service.ts:218 | `apply_task_projection_transition` | `idempotencyKey` | cacheable |
| src/modules/transitions/transition-consumption.service.ts:253 | `record_transition_apply_audit` | <code>idempotencyKey ?? `${event.eventId}:applied:${event.eventType}`</code> | cacheable |
| src/modules/transitions/transition-consumption.service.ts:275 | `apply_event_transition_to_task_projection` | `idempotencyKey` | cacheable |
| src/modules/transitions/transition-consumption.service.ts:376 | `record_transition_dry_run` | ``${event.eventId}:dry_run:${input.requestSource}`` | non-cacheable (executor allowlist) |
| src/modules/transitions/transition-consumption.service.ts:433 | `record_transition_ineligible` | <code>input.idempotencyKey ?? `${event.eventId}:apply_ineligible:${input.requestSource}`</code> | cacheable |
| src/modules/transitions/transition-consumption.service.ts:494 | `record_transition_apply_unsupported` | <code>input.idempotencyKey ?? `${event.eventId}:apply_unsupported:${input.requestSource}`</code> | cacheable |
| src/modules/transitions/transition-consumption.service.ts:543 | `record_transition_apply_audit` | <code>input.idempotencyKey ?? `${event.eventId}:already_applied:${input.requestSource}`</code> | cacheable |
| src/modules/transitions/transition-consumption.service.ts:575 | `record_transition_apply_audit` | <code>input.idempotencyKey ?? `${event.eventId}:applied:${input.requestSource}`</code> | cacheable |
| src/modules/user-intent/user-intent.routes.ts:127 | `record_user_intent` | ``${taskId}:user_intent:${input.intentType}:${input.ccbJobId ?? "manual"}`` | cacheable |
| src/modules/user-intent/user-intent.routes.ts:144 | `mark_anchor_idle_dirty_for_user_intent` | ``${taskId}:${anchor.anchorId}:stop-and-append-anchor-dirty`` | cacheable |
| src/modules/workspace/workspace.service.ts:84 | `apply_task_workspace_state` | ``${task.id}:apply_task_workspace_state:create:${branchName}`` | cacheable |
| src/modules/workspace/workspace.service.ts:116 | `apply_task_workspace_state` | ``${workspace.id}:apply_task_workspace_state:ready`` | cacheable |
| src/modules/workspace/workspace.service.ts:137 | `apply_task_workspace_state` | ``${workspace.id}:apply_task_workspace_state:error`` | cacheable |
| src/modules/workspace/workspace.service.ts:174 | `cleanup_task_workspace` | ``${workspace.id}:cleanup_task_workspace:pending`` | cacheable |
| src/modules/workspace/workspace.service.ts:195 | `cleanup_task_workspace` | ``${workspace.id}:cleanup_task_workspace:cleaned`` | cacheable |
| src/modules/workspace/workspace.service.ts:213 | `cleanup_task_workspace` | ``${workspace.id}:cleanup_task_workspace:error`` | cacheable |
| src/modules/scheduler/handlers/epic-lifecycle.handler.ts:82 | `create_replan_subtask` | ``${epic.id}:replan_${replanIndex}`` | non-cacheable (executor allowlist) |
| src/modules/scheduler/handlers/epic-lifecycle.handler.ts:121 | `append_epic_replan_event_journal` | ``epic_replan:${reviewIntent.id}`` | cacheable |
| src/modules/scheduler/parallel-join/branch-state.service.ts:75 | `dispatch_scheduler_branch` | ``${input.taskId}:${input.branchSetId}:${branchId}:dispatch_branch`` | cacheable |
| src/modules/scheduler/parallel-join/branch-state.service.ts:120 | `mark_scheduler_branch_started` | ``${input.taskId}:${input.branchSetId}:${input.branchId}:branch_started`` | cacheable |
| src/modules/scheduler/parallel-join/branch-state.service.ts:152 | `mark_scheduler_branch_finished` | ``${input.taskId}:${input.branchSetId}:${input.branchId}:branch_finished:${input.eventId ?? "no-event"}`` | cacheable |
| src/modules/scheduler/parallel-join/branch-state.service.ts:189 | `mark_scheduler_branch_failed` | ``${input.taskId}:${input.branchSetId}:${input.branchId}:branch_failed:${input.eventId ?? "no-event"}`` | cacheable |
| src/modules/scheduler/parallel-join/branch-state.service.ts:229 | `cancel_scheduler_branches` | ``${input.taskId}:${input.branchSetId}:cancel_branches:${cancellable.join(",")}`` | cacheable |

## Notes

- `create_sync_job` and UI `create_review_intent` use `null` keys. That is acceptable for this slice as an audit-only record pattern, but they do not provide replay caching if callers retry the same logical action.
- `record_hook_audit_log` uses `Date.now()` in the key; it avoids collisions but intentionally records every hook invocation as a distinct audit event.
- `append_event_journal` is explicitly non-cacheable in the executor, so the event service's own event id / idempotency key remains the business dedupe mechanism.
- `create_replan_subtask` and `revert_epic_status_to_planning` are also executor non-cacheable by F7-B design; their business guards and row constraints remain the source of truth.
