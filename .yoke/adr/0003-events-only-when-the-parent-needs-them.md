# ADR 0003: Events only when the parent needs them

Date: 2026-10-30
Status: accepted

## Context

ADR 0001 made every stop of a child turn a `turn_end` Event and every wait for a
human (`permission_prompt`, `idle_prompt`, `elicitation_dialog`; Pi
`ui_prompt_start`) a `waiting` Event. One evening of a task chat reporting to its
project chat (HO-1 → HO) produced 19 Events while the project chat had started
none of HO-1's turns; the project chat spent 23 turns retelling them without a
single decision. An Event is needed when its receiver has to act on it and no one
else will.

## Decision

Three rules decide which Events exist; nothing is configured by hand (no `/open`
flag, no command in the child):

1. Answer to whoever asked. A `turn_end` Event is created only when the child's
   turn was started by a parent message in the mypi parent-message frame
   (`[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение
   родительской сессии]`, `parentFrame` and `isParentMessage` in
   `src/modules/events/public.ts`). Claude: the last transcript entry that opened
   the turn has `turnOrigin` `peer` and contains the frame (`peer` alone also
   covers teammates' SendMessage). Pi: the extension marks the run when a batch
   with the frame arrives through its socket and clears the mark on
   `agent_settled`. A turn a person started creates nothing; an unreadable
   transcript or a missing mark creates nothing.
2. Milestones. A task's status change to `review`, `blocked`, `merged` or any
   terminal status creates a `milestone` Event for the project chat, unless the
   project chat itself makes the change (the caller's key, resolved like the
   warmup's, equals the task's parent). Milestones are never sent live: they wait
   for `/inbox` and the project warmup and never start a turn.
3. Waiting for input. `idle_prompt` never creates an Event. `permission_prompt`
   and `elicitation_dialog` (Claude) and `ui_prompt_start` (Pi) create a `waiting`
   Event only in a turn a parent message started.

A manual `mypi event emit --from` is not subject to these rules.

## Consequences

- Until the parent-to-child channel (MP-55) and the `/open` start message (MP-52)
  write the frame into a child's socket, the Claude hooks and the Pi extension
  create no `turn_end` or `waiting` Events at all; only milestones and a manual
  `event emit --from` remain.
- The Claude mark relies on undocumented transcript fields (`turnOrigin`,
  `message.content`; `docs/v2/facts.md`, fact 7); it is rechecked on a stand with
  every Claude Code update. When the mark disappears, Events stop rather than
  multiply.
- A parent message that arrives in the middle of a person's turn does not make
  that turn parent-started in Claude (a `queued_command` attachment opens no
  turn); in Pi the mark covers the whole run until `agent_settled`.
- The `milestone` kind needs schema 9 (migration 009). «Последние доклады» in the
  project warmup shows only the last delivered `turn_end` of each task.
