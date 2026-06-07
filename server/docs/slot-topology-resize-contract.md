# Slot Topology and Resize Contract

This note records the backend contract for project-scoped dynamic business slots.
It covers the server implementation surface only; the SlotsPage controls are a
separate UI slice.

## Data Flow

- `Project.slotCount` is the source of truth for the business slot stack.
- `src/modules/slot-topology/slot-topology.service.ts` is the only place that
  derives slot ids, managed window names, managed agent names, and agent core
  metadata from a count.
- Managed config, scheduler routing, slot projection, terminal lookup, and
  user-intent validation consume the count through database reads or an upstream
  project object. They must not cache a module-level business slot list.
- Slot ids are contiguous and stack-shaped: grow adds the next tail slot, shrink
  removes only the current tail slot.

## Compatibility Reversal

Commit `e6d3663` changed the managed main anchor from five fixed business slots
to three fixed business slots and updated the affected tests and lint script.
The dynamic-slot implementation keeps the three-slot default and the semicolon
window separator from that change, but reverses the fixed-count assumption:

- Tests that assert the default shape should continue to assert three slots.
- Tests for scheduler, projection, and resize behavior should construct project
  records with the intended `slotCount` instead of relying on global constants.
- `scripts/lint_main_anchor_config.py` validates the same core fields as before,
  but derives the expected windows and agents from the contiguous stack present
  in `[windows]`.

## Topology Service

- The accepted slot count range is 1 through 16.
- `slotIds(count)` returns `slot-1` through `slot-N`.
- `agentNamesForSlot("slot-N")` returns the claude and codex agent names for
  that slot.
- Managed config rendering uses the topology's window and agent sets for both
  generation and core signature calculation, so a three-slot project remains
  byte-compatible with the previous default output.

## Config Mutation Lock

- `ManagedConfigMutationLock` is a process-local, per-project mutex around
  writes to `.ccb/ccb.config` and slot count resize operations.
- Managed config ensure/restore, slot tips sync, resize, bind, enqueue, and
  worker dispatch paths either run inside the lock or wait briefly before
  touching slot-dependent state.
- The resize wait timeout is reported as HTTP 409 with
  `code = "SLOT_RESIZE_LOCK_TIMEOUT"`, `projectId`, and `timeoutMs`.

## Resize Service

- `SlotResizeService.grow(projectId)` writes the N+1 config, applies `ccb reload`
  when the project runtime is online, updates `Project.slotCount`, waits for the
  new tail slot to become active, then resets that slot context.
- If the project runtime is offline, grow records the desired count and config;
  the next managed runtime start applies the topology.
- `SlotResizeService.shrink(projectId)` checks the current tail slot before any
  removal:
  - no active non-idle slot binding;
  - no pending or submitted dispatch queue rows for that slot, including cancel
    commands;
  - no active runtime job.
- Shrink preserves tail-slot non-core agent fields in `slotAgentOverridesJson`,
  updates the database count, writes the N-1 config, then reloads online
  runtimes. Reload failure rolls back database count and config.
- Resize never deletes `.ccb/agents/slotN_*` directories from disk.

## API Surface

- `GET /api/projects/:projectId/slots` returns the slot projection plus:
  - top-level `slotCount`;
  - `project.slotCount`;
  - `shrinkEligibility`, including `checks.slotBindingIdle`,
    `checks.queueClear`, `checks.runtimeIdle`, `reasons`, and `details`.
- `POST /api/projects/:projectId/slots/resize` accepts
  `{ "direction": "grow" | "shrink" }`.
- Successful resize returns the current slot projection plus
  `resize.ok = true`, `direction`, `mode`, previous and next counts, reload
  result, and slot context reset result.
- Failed resize returns the service failure body directly with
  `ok = false`, `reason`, and optional `details` or `reload`; callers should
  not rewrite or flatten this body before presenting diagnostics.
