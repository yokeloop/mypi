# ADR 0001: One event contract, delivery transport per agent pair

Date: 2026-10-24
Status: accepted

## Context

Every Session in mypi v2 runs under one of two Agents (Claude Code, Pi). When a
child Session's turn stops, an Event with its final message must reach the live
Parent Session. Neither Agent offers an external "send a message into a live
interactive session" API usable from a foreign process:

- Pi: an extension running inside the session can call
  `pi.sendUserMessage(text, { deliverAs })`. The mypi extension is present in every
  Pi session started by the Launcher.
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
| any → Pi | child writes Event to the Queue; parent's mypi extension injects it with `sendUserMessage` |
| Claude → Claude | parent subscribes with `SendMessage(notify_when_idle)` when opening the child; child's `Stop` hook writes the Event and, if the parent is live, blocks once with "deliver Event N to parent via SendMessage" |
| Pi → Claude | child writes the Event; mypi types a short marker line into the parent's Herdr tab; the parent's `UserPromptSubmit` hook replaces the marker with the Queue contents |
| any → busy Claude | Event waits; the parent's own `Stop` hook drains the Queue with `decision: block` |

Mixed-Agent trees are allowed. Herdr participates in delivery only for Pi → Claude.

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

## Consequences

- A `SessionAdapter` per Agent implements: launch arguments, turn-end detection and
  final-message capture, delivery, warmup injection, liveness.
- Delivery happens only at turn boundaries for every Agent, even where Pi could
  steer mid-turn, so a tree behaves the same regardless of its Agents.
- If Anthropic documents the peer protocol, only the Claude adapter changes.
