# Anchor Terminal WS Contract

Endpoint: `GET /api/anchor-terminal/ws?anchorId=<anchorId>&pane=<paneName>` using WebSocket.

Frames are JSON text frames, compatible with the existing ai-cli xterm client shape.

Client to server:

```json
{ "type": "ping" }
{ "type": "close" }
{ "type": "viewport", "cols": 142, "rows": 38, "active": true }
{ "type": "request_write" }
{ "type": "release_write" }
{ "type": "in", "data": "\u0003" }
{ "type": "resize", "cols": 142, "rows": 38 }
```

`viewport` is a read-only viewport hint from the fitted browser terminal. The server clamps it to
`cols: 60..300` and `rows: 10..100`, debounces tmux resize, zooms the attached pane, and restores
the original tmux layout when the last web client detaches. `active` defaults to `true`; if multiple
clients report active viewports, the latest one wins.

Write mode is gated by a per-`anchorId:pane` writer lease. `request_write` grants the lease when it
is free, otherwise the server replies with `lease_denied`. `release_write` releases only the current
holder. `in` sends literal UTF-8/xterm bytes to tmux via `send-keys -l`; `resize` is a write-mode
resize signal and requires the same lease. Without a lease, `in` and `resize` return
`WRITER_LEASE_REQUIRED`.

Legacy `write` is not part of the protocol and is rejected with `READ_ONLY`:

```json
{ "type": "write", "data": "..." }
```

Server to client:

```json
{ "type": "ready", "descriptor": { "anchorId": "anchor_x", "taskId": "task_x", "pane": "ccb_claude", "source": "anchor", "readonly": true, "recordingId": "anchor_x--ccb_claude", "attachedSocketCount": 1, "writer": { "hasWriter": false, "isYou": false } } }
{ "type": "frame", "data": "\u001b[32mansi screen snapshot\u001b[0m\r\n", "cols": 80, "rows": 31, "generation": 12 }
{ "type": "lease_changed", "hasWriter": true, "isYou": true, "since": "2026-05-16T13:00:00.000Z" }
{ "type": "lease_denied", "code": "WRITER_LEASE_TAKEN", "currentHolder": { "clientId": "client-a", "since": "2026-05-16T13:00:00.000Z" } }
{ "type": "pong" }
{ "type": "error", "code": "WRITER_LEASE_REQUIRED", "message": "writer lease required for anchor terminal input" }
{ "type": "exit", "code": 0, "signal": null, "reason": "anchor destroyed" }
```

`ready.descriptor` has no viewport max fields in TA8a; use the clamp ranges above. `frame.data` is
the authoritative `tmux capture-pane -p -e -J -S -2000` snapshot for the pane at the returned
`cols`/`rows`. `generation` is monotonic per pane stream so clients can drop stale frames. The
mirror loop defaults to 200ms and can be clamped with `CCB_ANCHOR_TERMINAL_MIRROR_INTERVAL_MS`
between 100 and 500ms. Legacy `{ "type": "out" }` remains reserved for compatibility with the
ai-cli-style protocol, but TA10 mirror attach does not normally send `out`; frontend clients should
render `frame` as a full-screen repaint instead of treating it as an incremental PTY stream.

Accepted `in` frames are audited as metadata only in
`data/anchor-terminal/audit/<anchorId>.jsonl`: frame count, byte count, SHA-256, client id, pane,
remote address, and timestamps. Raw keystrokes are not stored and are not written to asciinema casts.

REST:

- `GET /api/anchor-terminal/panes?anchorId=<anchorId>` returns `{ items: [{ name, title, currentCommand, active }] }`.
- `GET /api/anchor-terminal/recordings?anchorId=<anchorId>` returns `{ items }`.
- `GET /api/anchor-terminal/recordings/:id/cast` returns `{ meta, cast }`, matching the ai-cli recording fetch shape.
