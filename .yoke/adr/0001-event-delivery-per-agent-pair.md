# ADR 0001: One event contract, delivery transport per parent Agent

Date: 2026-10-24, revised 2026-10-26 after review
Status: accepted

## Context

Every Session in mypi v2 runs under one of two Agents (Claude Code, Pi). When a
child Session's turn stops, an Event with its final message must reach the
Parent Session. Neither Agent offers an external "send a message into a live
interactive session" API usable from a foreign process:

- Pi 1.0.4: an extension running inside the session can call
  `pi.sendUserMessage(text, { deliverAs: "followUp" })` and may listen on a local
  socket; Pi keeps no registry of live sessions, but the extension observes
  `session_start`, `agent_start`, `agent_settled` and `session_shutdown`.
- Claude Code (checked against the current hooks and CLI reference on
  2026-10-26, installed 2.1.283, latest 2.1.310): `claude agents --json` lists
  live sessions (interactive and background) with pid, sessionId, name and
  busy/waiting/idle status. Hooks (`SessionStart`, `Stop` with
  `decision: block`, `UserPromptSubmit`, `PostToolUse`) inject text only into
  their own session and only while it is acting; no hook output field and no
  CLI command sends into another session. The in-session `SendMessage` tool
  reaches another named session, but only the model can call it. Herdr can type
  a line into any tab.

## Decision

The Event contract is identical for all Agents: every stop of a child turn
creates exactly one Event with the final message; the delivered text has one
format (`[MP-12 завершил ход в 14:02, событие 42]` + text); Events go one level
up only, so a parent's own stop after handling a child Event becomes an Event for
its parent (expected cascade in MVP). mypi never interrupts a parent's turn.

The transport depends on the parent's Agent:

| Parent | Transport | When |
|---|---|---|
| Pi, live | `mypi event emit` writes the Event and pushes its text to the parent's socket `$XDG_RUNTIME_DIR/mypi/<key>.sock`; the extension injects it with `sendUserMessage(followUp)` and acknowledges, which marks the Event delivered | at once if idle, end of current turn if busy |
| Claude, live | the Event waits; the parent's `Stop` hook at the end of its next turn reads the Queue and continues the turn with `decision: block` | next turn boundary |
| closed | the Event waits in `/queue` and enters the next warmup | on open |

Waking an idle Claude parent is deferred to stage 2 (see below). Herdr takes no
part in delivery. No Agent polls.

Supporting rules:

- Delivery is at-least-once: an Event is marked delivered when handed to the
  Agent (Pi: on the extension's ack; Claude: when the `Stop` hook emits it in
  `reason` or warmup includes it). The Event number in the text lets an Agent
  recognise a repeat.
- A child's `Stop` hook calls `mypi turn end`; when the input carries
  `stop_hook_active` the command creates no second Event and never blocks again.
- Scope resolution is the same for both Agents: `sessions` row by native session
  id, then `MYPI_SCOPE`, then `global`.
- Liveness and busy state come from one mypi session registry
  (`$XDG_RUNTIME_DIR/mypi/sessions/<key>.json`): the Claude record is derived
  from `claude agents --json` (its cost inside a hook is measured in stage 3;
  reading Claude's registry files is the fallback); the Pi record is written by
  the extension (busy on `agent_start`, idle on `agent_settled`, removed on
  `session_shutdown`).
- The tracked `.claude/settings.json` carries an allow-list for mypi tools so a
  child in an unattended tab never blocks on a permission prompt.

## Deferred to stage 2: waking an idle Claude parent

Candidates, in the order they should be re-evaluated against the Claude Code
version current at that time:

1. The child's `Stop` hook blocks once with "send Event N to parent <name> via
   SendMessage"; a `PostToolUse` hook on `SendMessage` confirms delivery. Works
   today, but needs the model in the loop, a `SendMessage` permission, the same
   permission mode in parent and child, and a stable parent name.
2. Claude background sessions with the `Notification` hook (`agent_completed`).
3. A Herdr-typed marker line expanded by `UserPromptSubmit` — last resort: it
   types into an input box that may hold a dialog or the operator's text.

## Alternatives rejected

- One transport for both (Herdr typing): event text travels through the
  terminal; Herdr becomes mandatory for messaging, not only tabs.
- Reverse-engineering the Claude peer socket: undocumented, breaks on updates.
- A headless `claude -p` bridge: an LLM call and seconds per Event.
- Requiring children to report from the model's memory: reintroduces the
  discipline the product grill removed.
- Polling the Queue from the Pi extension (turn boundary plus an idle timer):
  a timer where an explicit trigger exists.
- A wake signal ("check the Queue") over the socket instead of the Event itself:
  an extra round trip through the database for nothing.
- Parent subscription `SendMessage(notify_when_idle)`: one-shot, carries no text,
  must be renewed by the parent model after every child stop.
- Asking Herdr (`herdr agent get`) for Pi busy state: ties liveness to Herdr.
- Checking the parent is idle before a child-side `SendMessage` to preserve
  "turn boundary only": extra state and a race for a rule that protects nothing.
- Marking Events delivered only on confirmed reading: needs the model's word
  and produces duplicates.

## Consequences

- A `SessionAdapter` per Agent implements: registry record, scope resolution,
  launch arguments, turn-end detection and final-message capture, delivery.
- In MVP the conductor scenario (a parent that reacts on its own) works only on
  Pi parents; a Claude parent reacts at its next turn or on open.
- To verify before stage 3: whether `pi --session-id` continues an existing
  session; whether `herdr agent start --kind claude|pi` forwards extra arguments
  and environment; whether `herdr tab create` works when the main chat runs
  outside Herdr; how long `claude agents --json` takes from a hook.
