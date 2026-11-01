# ADR 0004: Parent-to-child channel

Date: 2026-11-01
Status: accepted

## Context

Events went only up, from a task chat to its project chat (`turn_end`, `waiting`,
`milestone`). Nothing wrote the parent-message frame (`parentFrame`) into a child's
session, so rule 1 of ADR 0003, «answer to whoever asked», never fired, and a
project chat could not lead a task through its stages.

## Decision

1. One table. A parent message is an `events` row of kind `message` (schema 10,
   migration 010): `from_key` is the parent, `to_key` the child. The queue,
   `pending`, `deliver` and the transports are the ones events already use.
2. Only the direct parent. A project chat writes to its own tasks and the main
   chat (`global`) to projects; the sender is the calling session's resolved key
   (its registered key, else `MYPI_SCOPE`). Any other sender is refused with the
   name of the allowed parent, and nothing is written. Entry points are MCP
   `send_message`, CLI `mypi send` and `/open <key> --message` (MCP
   `open_session.message`), all one application command.
3. One message on open. A live child gets the message at once in the
   parent-message frame. A closed child gets its queued messages once at the next
   `/open`: after a start they go in the same message as the start text, after a
   resume alone. Claude writes one JSON line per message, and a second line in the
   middle of a turn becomes a `queued_command` that opens no turn.
4. Not in the warmup. The warmup neither shows nor marks parent messages; the
   child's own `/inbox` returns and marks them, `/inbox all` skips them.
5. No authorization. A parent instruction never stands in for the engineer's
   word, even when it quotes the user: /do, /ship, merge, release, migration and
   an engine update still need the engineer in the child's tab. Roles, skills and
   documentation say so; no authorization is forwarded.

## Consequences

- Schema 10: the installed engine needs `mypi db init` once after the update.
- This ADR removes the first consequence of ADR 0003 («Until the parent-to-child
  channel (MP-55) …»): parent-started turns now exist, and their `turn_end` and
  `waiting` Events reach the parent. ADR 0003 itself is unchanged.
- A Claude child in `bypassPermissions` started without `accept` gets no live
  delivery; its messages wait for the next `/open` or its `/inbox`.
- A busy Claude child takes the message as a `queued_command` in its current
  turn, with no `turn_end` of its own; Pi takes it as a `followUp` after the run.
  There is no busy check.
- Delivery stays at-least-once; there is no deduplication beyond the event id.
