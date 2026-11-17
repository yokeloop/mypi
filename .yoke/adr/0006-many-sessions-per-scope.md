# ADR 0006: Many sessions per scope

Date: 2026-11-17
Status: accepted

Amends ADR 0001, ADR 0004 and ADR 0005.

## Context

A scope key had one `sessions` row (`key` was the primary key, a new session
overwrote the agent and native id of the previous one) and one canonical live
registry record `<key>.json`. Registering a second live session of the key
displaced the first to `<key>~<pid>.json`; `lookup`, `tree` and delivery used only
the canonical record, so the older session silently stopped receiving events
(ADR 0001, decision 27). `/open` chose one action from that one row. Neither agent
reported the engineer's input: Claude had no `UserPromptSubmit` hook, the Pi
extension did not listen to `input`.

The engineer lifted the one-session-per-scope limit: within one task they switch
between Claude and Pi, and later between devices.

## Decision

1. Scope and sessions. A scope (global, organization, project, task) is the
   permanent entity: key, card, journal, incoming events. A session is a
   `sessions` row with its own `id`, the scope `key` (not unique, indexed), agent,
   `native_id` (`UNIQUE (agent, native_id)`), `device`, `created_at`, `active_at`
   (null: never active) and `ended_at` (created now, written later). A key has
   many rows. Switching Claude ↔ Pi within a task and switching devices are one
   case: the engineer writes to another session of the same scope.
2. Device. `device` is `os.hostname()`; in remote mode the optional `device` field
   of `server.json` overrides it (MP-147). Migration 016 moves every existing row
   as one row of its key with this machine's name and `active_at = created_at`.
3. The active session of a key is the row with the greatest `active_at` (ties: the
   greater `id`): where the engineer wrote last. The engineer's input writes
   `active_at = now` to its own row through `mypi session prompt`: Claude's
   `UserPromptSubmit` hook, Pi's `input` event with `source: "interactive"`. A
   prompt in a mypi frame (`[mypi: …`, also after Claude's
   `Another Claude session sent a message:` line) and Claude input whose `source`
   is not `user` do not count; Pi input from `rpc` or `extension` (socket messages
   arrive through `sendUserMessage`) does not count.
4. Registration. Every live process has its own record `<key>~<pid>.json`; there
   is no canonical record and no displacement. A new row becomes active when the
   key has no other live record besides this process's own. Claude `/clear` and Pi
   `/new` replace the process's own record; the new row becomes active when the
   replaced record's row was the active one, otherwise it stays inactive.
5. Delivery. `deliverPending` claims the events of the key for the active row
   when its record is live, then sends them to that socket; the start message goes
   to the socket of the live record of the active row. When the active session is
   not live, nothing is sent and nothing is marked: the events wait. In remote mode a live session subscribes
   to `GET /v1/changes` and claims its own events (MP-147).
6. Incoming events of a scope and atomic claim. Events stay addressed to the key.
   Migration 017 adds `events.claimed_by` (session row, `ON DELETE SET NULL`) and
   `claimed_at`. A claim is one transaction: only the live active session of the
   key takes undelivered, unclaimed rows except milestones; the send runs outside
   the transaction; acknowledged rows get `delivered_at` and keep `claimed_by`, the
   rest are released. `session prompt` makes the session active and, when it has
   its own socket and transport, takes every undelivered row of the key except
   milestones, claimed ones included, and sends them to its own socket. `/open`
   claims only message rows after the started record appears, just before the
   send. `/inbox` and the warmup take every undelivered row and write the caller's
   row (or `NULL`). A row left claimed by a crashed process waits for the next
   engineer prompt, `/inbox` or warmup, no timer; a takeover during a send in
   flight can repeat a row (at-least-once). At-least-once from ADR 0001 stays.
7. Pointer after a switch. When the engineer writes to a session that was not the
   active one and it already had a turn, one line tells it which session worked in
   the scope since its last turn and where to read more (MP-143). Until then the
   `session prompt` hook prints nothing.
8. `/open`. Without flags it works on the sessions of this device: focus the live
   record of the device's active row; else the live record whose row has the latest
   `active_at`; else resume the device's row active last; else start a new session.
   `--agent X` limits this to the sessions of agent X and starts a new session of X
   when there are none. `--new` starts a new session. `--session <native-id>`
   returns to that session of the key on this device; a session of another device is
   an input error. `start`, `resume` and `focus` write `active_at` of the opened
   session before delivery. The Herdr name is the first free one of `<key>`,
   `<key>-<agent>`, `<key>-<agent>-2`, …; it is passed in the tab environment as
   `MYPI_HERDR_NAME`, stored in the optional field `herdrName` of the registry
   record, and focus uses it.
9. Concurrent work. When a new session starts while another session of the key is
   live, its warmup (the CLI warmup of the Claude `SessionStart` hook and the Pi
   extension, not the MCP `warmup` tool) starts with
   `в этом скоупе уже есть живая сессия: <agent> на <device>`. "One writer per
   worktree" stays a rule, not a lock.
10. `mypi sessions` (MCP `sessions`, `GET /v1/sessions`) keeps `session` on a node,
    now the active session, and adds `sessions`: every session of the key, last
    active first, with agent, native id, device, `activeAt` and live or closed.

## Consequences

- Simpler: no `displace` and `displacedAt` in the registry, no canonical record and
  no displacement on registration; no silent loss of events by an older session;
  a scope needs no state summary on a switch, one line will do.
- Schema 16: the installed engine needs `mypi db init` once after the update. Old
  registry files `<key>.json` and displaced `<key>~<pid>.json` are removed by the
  first registry write after the update.
- `register` no longer returns `displaced`; `mypi session forget <key>` deletes
  every row of the key.
- Schema 17: the installed engine needs `mypi db init` once after the update.
- ADR 0001: decision 27 (the newest live session is canonical, the older one
  stops receiving events) is replaced by points 3–5; the Pi socket stays one per
  process; the event contract, frames and key resolution do not change.
- ADR 0004: a closed child gets its queue at the next `/open` or at the
  engineer's first input in any of its sessions.
- ADR 0005: point 7 is superseded by migration 016 for the shape of `sessions`;
  the organization scope and report routing do not change.
- ADR 0002 and ADR 0003 do not change.

## Stand facts

- Stand 2026-11-17 (Claude Code 2.1.326): a message delivered into the Claude
  inbox socket fires `UserPromptSubmit`. The hook input has no `source` field, and
  neither does the engineer's typed prompt. Its `prompt` is the raw frame text
  starting with `[mypi: `, without the `Another Claude session sent a message:`
  wrapper that the screen and transcript show. The transcript marks it
  `promptSource: "system"`, `turnOrigin: "peer"`. `session prompt --agent claude
  --hook` therefore excludes it by the mypi frame, not by `source`; the active
  session did not change. `/clear` does not fire `UserPromptSubmit`; the new row
  became active by decision 2.
- Stand 2026-11-17 (Claude Code 2.1.326, Haiku 4.5): with a message waiting for
  FX-1 and the Claude session not active, the engineer typed into that session.
  Inside its own `UserPromptSubmit` hook, `session prompt` made the session active
  (11:34:00.749Z), claimed the row (11:34:00.750Z) and sent it to the session's
  own inbox socket. The socket acknowledged it while the hook was still pending
  (`delivered_at` 11:34:00.776Z, `claimed_by` = the session's row), with no
  deadlock and no 5 s hook timeout. The screen showed the frame queued under the
  typed prompt at once, but the message did not join the typed turn. Claude
  answered the typed prompt first (Stop 11:34:04.184Z), then ran a separate turn
  for the message (transcript `promptSource: "system"`, `turnOrigin: "peer"`,
  11:34:04.213Z). That turn fired `UserPromptSubmit` with the raw `[mypi: ` frame,
  which was not counted as input (`active_at` unchanged), and its Stop recorded
  the `turn_end` for the parent. Pi 1.5.2: with the input handler not awaiting
  `session prompt`, the engineer's text started the turn within 0.3 s and the
  claimed message arrived as a follow-up, acknowledged 83–98 ms after Enter, with
  no 2 s stall.
