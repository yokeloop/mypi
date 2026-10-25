# ADR 0001: One event contract, delivery transport per agent pair

Date: 2026-10-24
Status: accepted

## Context

Every Session in mypi v2 runs under one of two Agents (Claude Code, Pi). When a
child Session's turn stops, an Event with its final message must reach the live
Parent Session. Neither Agent offers an external "send a message into a live
interactive session" API usable from a foreign process:

- Pi: an extension running inside the session can call
  `pi.sendUserMessage(text, { deliverAs })` and may listen on a local socket; Pi
  keeps no registry of live sessions, but the extension observes `agent_start`,
  `agent_settled` and `session_shutdown`. The mypi extension is present in every
  Pi session started from the engine root.
- Claude Code (checked against the current hooks and CLI reference, 2026-10-26):
  `claude agents --json` lists live sessions (interactive and background) with
  pid, sessionId, name and busy/idle status. The in-session `SendMessage` tool
  delivers text to another named session; it is a model tool, and no hook output
  field or CLI command can send into another session. Hooks (`Stop` with
  `decision: block`, `UserPromptSubmit`, `SessionStart`) inject text only into
  their own session and only when it is already acting; `PostToolUse` can match
  `SendMessage` by name. Herdr can type a line into any tab (`herdr agent prompt`).

## Decision

The Event contract (what is recorded, the delivered text format, delivery at a turn
boundary) is identical for all Agents. The transport differs per (child, parent)
Agent pair:

| Child → Parent | Transport |
|---|---|
| any → Pi | `mypi event emit` writes the Event, looks the parent up in the session registry and pushes the Event itself to the parent's socket; the parent's extension injects it with `sendUserMessage(followUp)` and acknowledges, which marks the Event delivered; no socket or no ack leaves it in the Queue for warmup |
| Claude → Claude | the child's `Stop` hook writes the Event (pending), finds a live named Claude parent via `claude agents --json`, and blocks once with "send this Event to parent <name> via SendMessage: <text>"; the child makes one `SendMessage` call; the child's `PostToolUse` hook on `SendMessage` marks the Event delivered; the next `Stop` carries `stop_hook_active` and never blocks again. An idle parent is woken by the message, a busy parent sees it at its next tool step |
| Pi → idle Claude | `mypi event emit` types the marker line `mypi inbox` into the parent's Herdr tab; the parent's `UserPromptSubmit` hook replaces the marker with the Queue contents |
| Pi → busy Claude | Event waits; at the end of the parent's current turn its `Stop` hook reads the Queue and continues the turn with `decision: block` |

Mixed-Agent trees are allowed. Herdr participates in delivery only for Pi → idle Claude.
No Agent polls: every delivery starts from an explicit trigger (Event pushed to
the socket, the child's `SendMessage`, terminal line, turn end, session start).
Anything a model step failed to deliver stays pending in the Queue and is
drained by the parent's `Stop` hook or warmup; the Queue is the source of truth.
`sendUserMessage` is an in-process extension API, so the socket is the only way
a foreign process reaches a Pi parent; the Queue is the fallback, not the path.

Liveness and busy state come from one mypi session registry
(`$XDG_RUNTIME_DIR/mypi/sessions/<key>.json`, same shape for both Agents): the
Claude record is derived from `claude agents --json` by session id; the Pi record is written by the extension (busy on `agent_start`,
idle on `agent_settled`, removed on `session_shutdown`). Herdr is not consulted.

## Alternatives rejected

- One transport for both (Herdr typing): lowest common denominator; event text
  travels through the terminal; Herdr becomes mandatory for messaging, not only tabs.
- Reverse-engineering the Claude peer socket: most native, but keyed and
  undocumented; breaks on any Claude Code update.
- A headless `claude -p` bridge that performs `SendMessage`: documented surfaces,
  but an LLM call and several seconds per Event.
- Forbidding mixed trees (children inherit the parent's Agent): removes the hard
  pair, but the operator wants to mix Agents freely.
- Requiring children to report explicitly: reintroduces the discipline the product
  grill removed and fails for mixed pairs.
- Polling the Queue from the Pi extension (turn boundary plus an idle timer):
  simplest code, but a timer where an explicit trigger exists; rejected in review.
- A wake signal ("check the Queue") over the socket instead of the Event itself:
  one extra round trip through the database for nothing; rejected in review.
- Asking Herdr (`herdr agent get`) for Pi busy state: ties liveness to Herdr,
  which is required only for `/open`.
- Parent subscription `SendMessage(notify_when_idle)`: one-shot, carries no text,
  must be renewed by the parent model after every child stop; more steps for the
  same result. Replaced by the child-side send in review.
- Herdr marker line for Claude children too: the only path with no model step,
  but it makes Herdr mandatory for messaging and types into an input box the
  operator may be using.

## Consequences

- A `SessionAdapter` per Agent implements: launch arguments, turn-end detection and
  final-message capture, delivery, warmup injection, registry record.
- Delivery happens only at turn boundaries for every Agent, even where Pi could
  steer mid-turn, so a tree behaves the same regardless of its Agents.
- If Anthropic documents the peer protocol, only the Claude adapter changes.
