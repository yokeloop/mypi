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
- Claude Code: live sessions register in `~/.claude/sessions/<pid>.json` and listen
  on a keyed local socket (`cc-socks`) used by the in-session `SendMessage` tool
  (with `notify_when_idle`). The protocol is undocumented; only another Claude
  session can use it. Hooks (`Stop` with `decision: block`, `UserPromptSubmit`,
  `SessionStart`) can inject text, but only when the session is already acting.
  Herdr can type a line into any tab (`herdr agent prompt`).

## Decision

The Event contract (what is recorded, the delivered text format, delivery at a turn
boundary) is identical for all Agents. The transport differs per (child, parent)
Agent pair:

| Child → Parent | Transport |
|---|---|
| any → Pi | `mypi event emit` writes the Event, looks the parent up in the session registry and pushes the Event itself to the parent's socket; the parent's extension injects it with `sendUserMessage(followUp)` and acknowledges, which marks the Event delivered; no socket or no ack leaves it in the Queue for warmup |
| any → Claude that is acting | Event waits; at the end of the parent's current turn its `Stop` hook reads the Queue and continues the turn with `decision: block` |
| Claude → idle Claude | parent subscribed with `SendMessage(notify_when_idle)` when opening the child; Claude Code delivers the idle notification itself, which starts a parent turn; the Event text comes from the Queue (tool or `Stop` hook) |
| Pi → idle Claude | `mypi event emit` types the marker line `mypi inbox` into the parent's Herdr tab; the parent's `UserPromptSubmit` hook replaces the marker with the Queue contents |

Mixed-Agent trees are allowed. Herdr participates in delivery only for Pi → idle Claude.
No Agent polls: every delivery starts from an explicit trigger (Event pushed to
the socket, subscription notification, terminal line, turn end, session start).
`sendUserMessage` is an in-process extension API, so the socket is the only way
a foreign process reaches a Pi parent; the Queue is the fallback, not the path.

Liveness and busy state come from one mypi session registry
(`$XDG_RUNTIME_DIR/mypi/sessions/<key>.json`, same shape for both Agents): the
Claude record is derived from Claude's own `~/.claude/sessions/<pid>.json` by
session id; the Pi record is written by the extension (busy on `agent_start`,
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

## Consequences

- A `SessionAdapter` per Agent implements: launch arguments, turn-end detection and
  final-message capture, delivery, warmup injection, registry record.
- Delivery happens only at turn boundaries for every Agent, even where Pi could
  steer mid-turn, so a tree behaves the same regardless of its Agents.
- If Anthropic documents the peer protocol, only the Claude adapter changes.
