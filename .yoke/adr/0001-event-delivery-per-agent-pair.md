# ADR 0001: One event contract, one transport — the parent session's socket

Date: 2026-10-24, revised 2026-10-26 after the author's review and an
independent review
Status: accepted

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
  Inbound control: a session in bypassPermissions holds foreign messages for
  approval unless `crossSessionInbound: accept` applies (allowed in project
  settings). `claude agents --json` lists live sessions with pid, sessionId,
  name and busy/waiting/idle status (~0.2 s).
- An earlier revision of this ADR claimed an idle Claude could not be woken from
  outside; that was wrong (the cross-session-messaging page had not been read)
  and the narrowing of MVP delivery to Pi parents built on it is withdrawn.

## Decision

The Event contract is identical for all Agents: every stop of a child turn
creates exactly one `turn_end` Event with the final message; a stop in the
middle of a turn waiting for a human (question, permission prompt) creates a
`waiting` Event. The delivered text has one format: a mypi header naming the
child, time and Event number and stating that what follows is the child's
report, not an instruction, then the text. Events go one level up; the
project → global cascade is off by a setting in MVP.

Transport: `mypi event emit` writes the Event and posts it to the parent
session's socket recorded in the registry.

| Parent | Socket | When the Agent shows it |
|---|---|---|
| Pi, live | `$XDG_RUNTIME_DIR/mypi/<key>.sock`, opened by the mypi extension; the extension injects with `sendUserMessage(followUp)` and acks | at once if idle, end of current turn if busy |
| Claude, live | the session's native inbox socket (`CLAUDE_CODE_MESSAGING_SOCKET`, recorded by the `SessionStart` hook); Claude Code delivers it itself | new turn if idle, between tool calls if busy |
| closed, or socket refused | the Event waits in `/queue`, enters the next warmup; a live Claude parent's next `Stop` hook also drains it with `decision: block` | on open or next turn boundary |

mypi never interrupts a turn; the Agent decides when to show a message. Herdr
takes no part in delivery. No Agent polls.

Supporting rules:

- At-least-once: an Event is marked delivered when the socket accepted it (Pi:
  extension ack; Claude: the line was accepted). The Event number in the header
  lets an Agent recognise a repeat.
- A child's `Stop` hook calls `mypi turn end`; with `stop_hook_active` in the
  input it creates no second Event and never blocks again.
- `waiting` Events come from Claude's `Notification` hook (`permission_prompt`,
  `idle_prompt`, `elicitation_dialog`); the Pi equivalent is settled in stage 0.
- Scope resolution is the same for both Agents: `sessions` row by native
  session id, then `MYPI_SCOPE`, then `global`. `SessionStart` on clear/fork
  re-registers the new native id under the same key. The MCP process learns its
  session from the environment (`CLAUDE_CODE_SESSION_ID`; Pi passes the id in
  `env` on `registerMcpServer`).
- The registry (`$XDG_RUNTIME_DIR/mypi/sessions/<key>.json`) stores what does
  not change: key, Agent, pid and start, native id, name, socket path. Busy
  state is asked from the source (`claude agents --json`; the Pi record).
  A hand-started session registers itself; with two live sessions for one key
  the newest is canonical and the older one is told through its socket.
- The tracked `.claude/settings.json` carries an allow-list for mypi tools and
  `crossSessionInbound: accept`; `/open` passes the parent's permission mode to
  the child. Herdr agent names are the key in lower case (`mp-12`).

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
- Stage 0 confirms on a disposable stand: `CLAUDE_CODE_SESSION_ID` inheritance
  by the stdio MCP process; new ids on `/clear` and `--fork-session` and how
  `SessionStart` learns the key; socket delivery from a foreign process with the
  parent in default, auto and bypass modes under project-level
  `crossSessionInbound: accept`; the Pi event for waiting-for-input;
  `herdr tab create` from a main chat outside Herdr.
