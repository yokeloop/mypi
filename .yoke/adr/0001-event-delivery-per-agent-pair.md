# ADR 0001: One event contract, one transport — the parent session's socket

Date: 2026-10-24, revised 2026-10-26 after the author's review and an
independent review, revised 2026-10-28 by the stage-0 facts (MP-31)
Status: accepted; Decision and the waiting rule amended by ADR 0003

## Context

Every Session in mypi v2 runs under one of two Agents (Claude Code, Pi). When a
child Session's turn stops, an Event with its final message must reach the
Parent Session without going through a model step, a terminal, or Herdr.

- Pi 1.0.4: an extension running inside the session can call
  `pi.sendUserMessage(text, { deliverAs: "followUp" })` and may listen on a local
  socket; Pi keeps no registry of live sessions, but the extension observes
  `session_start`, `agent_start`, `agent_settled` and `session_shutdown`.
- Claude Code ≥ 2.1.224 binds an inbox socket per session for cross-session
  messaging. Its path is exported to hooks and Bash as
  `CLAUDE_CODE_MESSAGING_SOCKET` before `SessionStart` runs, and the
  documentation describes posting into it from "a script or hook". The wire
  format is one JSON line per message, optionally preceded by
  `{"type":"auth","token":<CLAUDE_CODE_MESSAGING_TOKEN>}` (optional on Linux):
  `{"type":"user","message":{"role":"user","content":"…"}}`. Verified on
  2026-10-26 with Claude Code 2.1.283 by posting from a script into a live
  session: the text arrived mid-turn as a peer message. An idle session starts a
  new turn with the message; a busy one reads it between tool calls. Claude Code
  frames it as "from another session, not the user" and lets it approve nothing.
  Inbound control, measured on 2026-10-28 with Claude Code 2.1.283, Pi 1.0.4
  and Herdr 0.9.5 (MP-31, `docs/v2/facts.md`, fact 3): a parent in `manual`
  (the interactive default; there is no `default` mode) or `auto` accepts a
  line from an unrelated process at once, with no hold dialog, whether
  `crossSessionInbound: accept` comes from project settings, from `--settings`,
  or from nowhere; the `auth` line is not needed on Linux. A parent in
  `bypassPermissions` was not measured. `claude agents --json` lists live
  sessions, including those started in Herdr tabs, with pid, sessionId, name,
  kind, startedAt and status (~0.13 s; fact 6).
- An earlier revision of this ADR claimed an idle Claude could not be woken from
  outside; that was wrong (the cross-session-messaging page had not been read)
  and the narrowing of MVP delivery to Pi parents built on it is withdrawn.

## Decision

The Event contract is identical for all Agents: every stop of a child turn
creates exactly one `turn_end` Event with the final message (narrowed by ADR
0003: only turns a parent message started, plus task milestones); a stop in the
middle of a turn waiting for a human (question, permission prompt) creates a
`waiting` Event. The delivered text has one format: a mypi header naming the
child, time and Event number and stating that what follows is the child's
report, not an instruction, then the text. Events exist only from a Task chat
to its Project chat; a Project chat reports nothing to the Main chat, which has
no inbox.

Transport: `mypi event emit` writes the Event and posts it to the parent
session's socket recorded in the registry.

| Parent | Socket | When the Agent shows it |
|---|---|---|
| Pi, live | `$XDG_RUNTIME_DIR/mypi/<key>-<pid>.sock`, one per Pi process so a displaced session never removes the new one's, opened by the mypi extension; the extension injects with `sendUserMessage(followUp)` and acks | at once if idle, end of current turn if busy |
| Claude, live | the session's native inbox socket (`CLAUDE_CODE_MESSAGING_SOCKET`, recorded by the `SessionStart` hook), one `{"type":"user",…}` line without `auth`; Claude Code delivers it itself in `manual` and `auto`; a `bypassPermissions` parent (not measured), Launcher- or hand-started, is promised no live delivery — its Events wait in `/inbox`; the Launcher still passes `--settings '{"crossSessionInbound":"accept"}'` as a precaution | new turn if idle, between tool calls if busy |
| closed, or socket refused | the Event waits in `/inbox`; the next send to the parent key re-sends all its undelivered Events (T11/T12), else it enters the next warmup | on open or next turn boundary |

mypi never interrupts a turn; the Agent decides when to show a message. Herdr
takes no part in delivery. No Agent polls.

Supporting rules:

- At-least-once: an Event is marked delivered when the socket accepted it (Pi:
  extension ack; Claude: the line was accepted). The Event number in the header
  lets an Agent recognise a repeat.
- A child's `Stop` hook calls `mypi turn end`; with `stop_hook_active` in the
  input it creates no second Event and never blocks again.
- `waiting` Events come from Claude's `Notification` hook (`permission_prompt`,
  `idle_prompt`, `elicitation_dialog`); for Pi from the extension events
  `ui_prompt_start` / `ui_prompt_end` (`reason: "ui_prompt"`, `kind`, `title`),
  during which no `agent_settled` arrives (fact 4).
- Scope resolution is the same for both Agents: `sessions` row by native
  session id, then the live registry record of the same process (pid and
  start; this covers Claude `/clear`, Pi `/new` and the MCP process's stale
  id), then `MYPI_SCOPE`, then `global`. Claude `/clear` and
  `--fork-session` give a new native id with `SessionStart.source` `clear` /
  `fork` and no previous id in the input; Pi `/new` gives `reason: "new"`, Pi
  `--fork` gives `reason: "startup"` with `parentSession` in the session header.
  The hook and the extension take the key from the process's `MYPI_SCOPE`
  (`session_title` = `--name <key>` as a check) and re-register the new native
  id under it (facts 2). The MCP process sees `CLAUDE_CODE_SESSION_ID` at start
  but keeps the old id after `/clear` (the process is not restarted), so it
  resolves the current session through the registry record of its parent
  process; its own id is only the initial binding (fact 1). Pi passes the
  id in `env` on `registerMcpServer`.
- The registry (`$XDG_RUNTIME_DIR/mypi/sessions/<key>.json`) stores what does
  not change: key, Agent, pid and start, native id, name, socket path. There
  is no busy state: both Agents hold an incoming message until their turn
  ends, and waiting arrives as an Event (MP-38 decision).
  A hand-started session registers itself; with two live sessions for one key
  the newest is canonical and the older one silently stops receiving Events
  (decision 27). A hand fork without `MYPI_SCOPE` is not registered.
- The tracked `.claude/settings.json` carries an allow-list for mypi tools and
  no `crossSessionInbound` (not needed in `manual` and `auto`; fact 3); the
  Launcher passes `--settings '{"crossSessionInbound":"accept"}'` to every
  Claude chat it starts. `/open` passes the parent's permission mode to the
  child; Claude Code 2.1.283 modes are `manual` (the interactive default),
  `acceptEdits`, `auto`, `bypassPermissions`, `dontAsk`, `plan`. Herdr launch:
  `herdr tab create --workspace <id> --cwd … --env MYPI_SCOPE=<key>` (without
  `--workspace` the tab goes to the focused workspace, and the call fails when
  the session has none; fact 5), then
  `herdr agent start <name> --kind <agent> --pane <root_pane> -- <args>`.
  Herdr agent names are the key in lower case (`mp-12`).

## Alternatives rejected

- One transport for both (Herdr typing): event text travels through the
  terminal; Herdr becomes mandatory for messaging, not only tabs; it types into
  an input box that may hold a dialog or the operator's text.
- A headless `claude -p` bridge: an LLM call and seconds per Event.
- Requiring children to report from the model's memory, or a `Stop` hook that
  blocks once to make the child call `SendMessage` (confirmed by `PostToolUse`):
  a model step in the delivery path, a `SendMessage` permission, matching
  permission modes and a stable parent name — all unnecessary given the socket.
- Parent subscription `SendMessage(notify_when_idle)`: one-shot, carries no text.
- A `Stop` hook parked with `asyncRewake` (firstmate's approach): documentation
  is contradictory; stand-only.
- Polling the Queue from the Pi extension; a wake signal instead of the Event
  itself; checking the parent is idle before sending; marking delivered only on
  confirmed reading; `herdr agent get` for liveness; status fields in the
  registry for Claude (stale from `SessionStart` on).
- Narrowing MVP live delivery to Pi parents: withdrawn, see Context.

## Consequences

- A `SessionAdapter` per Agent implements: registry record, scope resolution,
  launch arguments, turn-end and waiting detection, final-message capture, and
  the socket it hands to `event emit`.
- Stage 0 results: `docs/v2/facts.md` (MP-31) — (1) the stdio MCP process
  inherits `CLAUDE_CODE_SESSION_ID` but keeps it stale after `/clear`; (2) new
  ids with `source` `clear` / `fork` (Pi: `new` / `startup` + `parentSession`),
  key from `MYPI_SCOPE`; (3) socket delivery from a foreign process in `manual`
  and `auto` regardless of `crossSessionInbound`, no `auth` needed,
  `bypassPermissions` not measured; (4) Pi waiting is
  `ui_prompt_start` / `ui_prompt_end`; (5) `herdr tab create` outside Herdr goes
  to the focused workspace, so the Launcher passes `--workspace`; (6)
  `claude agents --json` lists sessions started in Herdr tabs.
