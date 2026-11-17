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
5. Delivery. `deliverPending` and the start message go to the socket of the live
   record of the active row. When the active session is not live, nothing is sent
   and nothing is marked: the events wait. In remote mode a live session subscribes
   to `GET /v1/changes` and claims its own events (MP-147).
6. Incoming events of a scope and atomic claim. Events stay addressed to the key.
   A later migration adds `events.claimed_by` and `claimed_at`; the active session
   claims unmarked, unclaimed events of its key in one transaction, sends them to
   its socket, marks acknowledged ones delivered and releases the rest; the first
   session where the engineer writes takes over events that were claimed but never
   acknowledged (MP-142). At-least-once from ADR 0001 stays.
7. Pointer after a switch. When the engineer writes to a session that was not the
   active one and it already had a turn, one line tells it which session worked in
   the scope since its last turn and where to read more (MP-143). Until then the
   `session prompt` hook prints nothing.
8. `/open`. Until MP-141: focus the live record of the active row; else any live
   record of the key, by the latest `active_at` of its row; else resume the active
   row; else start a new session. MP-141 adds `--new` and `--session`.
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
- ADR 0001: decision 27 (the newest live session is canonical, the older one
  stops receiving events) is replaced by points 3–5; the Pi socket stays one per
  process; the event contract, frames and key resolution do not change.
- ADR 0004: a closed child still gets its queue at the next `/open`; with MP-142
  also at the engineer's first input in any of its sessions.
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
