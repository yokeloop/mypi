# Sessions, /open and event delivery

Read when: working with session registration, /open, start messages, events, milestones or parent messages and their delivery.

## Events and parent messages

- On `agent_settled` (with the last reply) and on `ui_prompt_start` (`--waiting`)
  the [Pi extension](agent-integration.md#pi) runs
  `mypi event emit` with the registered key and `--to` the sender of that frame,
  only in a turn that a message in the mypi parent-message frame started through
  its socket; the event goes to that sender when it is a parent of the task, else
  to the task's project. From `session_start` to
  `session_shutdown` it holds `$XDG_RUNTIME_DIR/mypi/<key>-<pid>.sock` (on macOS
  without the variable, `$TMPDIR/mypi/<key>-<pid>.sock`; 0600),
  one socket per Pi process, and registers its path; `mypi event emit` then
  claims all undelivered, unclaimed events of the parent except milestones for the
  parent's active session when it is a live Pi session, in one transaction
  (`events.claimed_by`, `claimed_at`), sends them outside it, marks the
  acknowledged ones delivered (they keep `claimed_by`) and releases the rest, also
  when the transport fails. A row claimed by another session is skipped.
  Without a live active session, a socket or an answer they wait for /inbox, the
  warmup or the first engineer input in a session of the key; nothing goes to
  another live session of the key. The engineer's input (`mypi session prompt`)
  makes that session active and, when it has its own socket and transport, takes
  every undelivered event of the key except milestones, claimed but unacknowledged
  ones included, and sends them to its own socket; so a row left claimed by a
  crashed sender waits for the next input, /inbox or warmup, without a timer.
  After a switch to a session of the key that already had a turn, and on the first
  input of a new session after another session of the key had a turn, the same call
  prints one pointer line of at most 200 characters, `[mypi: с вашего прошлого
  хода в <KEY> работала сессия <agent> на <device>: <n> записей журнала, <m>
  коммитов в ветке; подробнее — journal <KEY>]`; with another device of the
  previous session the commit part is `сначала git pull`, and commits are counted
  only for a task with a recorded worktree. A new session counts from its start and
  names the other session with the latest turn, even when it became active at
  registration or by /open. An ordinary turn, a second message in a row, the first
  session of a scope and the session after `/clear` in the active one after its
  turn get nothing;
  a failure computing the line prints nothing
  and keeps the touch and the claim. Claude gets the line as the hook output, Pi by
  `transform` of the input (before the text, at the end for input starting with
  `/`); `--no-deliver` only marks and prints.
  /open claims the queued messages of the opened session after its record
  appears, just before the send. /inbox and the warmup take every undelivered row,
  claimed ones included, and record the calling session in `claimed_by` (`NULL`
  when it cannot be resolved). A takeover while another send is in flight can
  repeat a row (at-least-once). A live active Claude parent gets them at once through
  its native inbox socket (`CLAUDE_CODE_MESSAGING_SOCKET`, recorded by the
  SessionStart hook), one `{"type":"user",…}` line per event; they count as
  delivered once the socket took the write (the server closed its side). A
  bypass parent gets them live only when started with `accept`, as /open does;
  this is not promised before a test-installation measurement. At-least-once: a
  missed server close repeats events, an event over 1 MiB is resent with every
  send and stays in /inbox and the warmup, and a message held in bypass and then
  rejected, or one the parent never handled, is lost after it was marked delivered.
  A status change to review, blocked, merged or a terminal status queues one
  milestone event for the parent that last sent the task a message, else the
  project chat, unless that recipient makes the change;
  milestones wait for /inbox and the warmup and are never sent live.
  Down go parent messages: a direct parent (project chat → its task, organization
  chat → a task of its organization, main chat → a project or an organization; the
  sender key is resolved like the warmup's — registered key, else `MYPI_SCOPE`,
  else `global`, so an unresolved caller counts as global and may send only to
  projects and organizations; any other sender is refused) writes an `events` row of
  kind `message` with send_message (CLI `mypi send`) or `/open <key> --message`.
  It goes through the same channels with the same at-least-once semantics as a
  new turn in the parent-message frame; a closed child gets its queue once at the
  next /open, in one message together with the start message. The warmup shows no
  parent message as a message, at most its `message_sent` journal fact line, and
  marks none of them; the child's own /inbox returns and marks them. A busy Claude
  child takes one as a `queued_command` inside the current turn, without its own
  `turn_end`; Pi takes it as a `followUp`.
- In Claude `turn_end` is created on the passing Stop. When `mypi turn end` hands
  the turn back with a block, no event is created until the second Stop
  (`stop_hook_active`), which carries the final answer; the block's entry in the
  transcript does not start a new turn for reading the turn prompt.
- In Pi a continuation requested by the save check (`mypi turn check` on
  `agent_before_settle`) does not settle the turn: `agent_settled` comes once after
  it, so the `turn_end` event goes once with the final reply.

## Session registry and /open

- Both agents register their sessions: a row in the `sessions` table (one per
  agent and native id: key, device, `active_at`, kept for continuation; a key has
  many rows) and a live record per process in
  `$XDG_RUNTIME_DIR/mypi/sessions/<key>~<pid>.json` (on macOS without
  `XDG_RUNTIME_DIR`, `$TMPDIR/mypi/sessions/`; owner-only; pid and process
  start, native id, name, socket, start permission mode). The key is resolved in
  one order: the row for this native id, the live record of the same process,
  `MYPI_SCOPE`, `global`. Many sessions of one key live side by side; none is
  displaced ([ADR 0006](../../.yoke/adr/0006-many-sessions-per-scope.md)). The
  active session of a key is the row where the engineer wrote last: Claude's
  `UserPromptSubmit` hook and the Pi extension's interactive `input` run
  `mypi session prompt`, which writes `active_at`, takes the waiting events of the
  key to its own socket and prints the pointer line only after a switch; a prompt in
  a mypi frame does not count. A new row is active when the key has no other live
  session; Claude `/clear` and Pi `/new` keep the active role when the replaced
  session had it. A resume of an existing session in the same process makes it
  active again. When another session of the key is live, the CLI warmup of a
  new session starts with `в этом скоупе уже есть живая сессия: <agent> на <device>`;
  one writer per worktree stays the rule. A fork started by hand without
  `MYPI_SCOPE` is not registered. `mypi sessions` (MCP `sessions`) shows the tree,
  each node with its active `session` and all its `sessions`;
  `mypi session forget <key>` drops every row of the key on the user's request.
  Without `XDG_RUNTIME_DIR` on Linux or an initialized schema 17 database registration
  fails and the warmup still runs; on macOS without the variable the registry is in
  `$TMPDIR`. /open (MCP open_session, CLI mypi open) works on the
  sessions of this device: it focuses a live session's Herdr tab (the active
  session's, else the live session active last; otherwise it resumes the session
  active last); `--agent` limits this to that agent and starts it when it has no
  session, `--new` starts a new session and `--session <native-id>` returns to a
  session of the key on this device (another device's is refused before Herdr and
  clones); a second session of a key gets the Herdr name `<key>-<agent>` (passed as
  `MYPI_HERDR_NAME`, kept in the registry record, used for focus). It opens a new tab in its project's Herdr workspace (label
  org/project, created when missing; a task gets its tab there without starting
  the project session; an organization key, the bare slug `tb-ff`, gets the tab
  `org-<slug>` in the workspace `<slug>`, with no clone or worktree, and an
  organization without registered projects is refused) in the engine root with MYPI_SCOPE and starts or resumes
  the agent, writing `active_at` of the opened session before delivery. A project without a clone is first cloned
  from its registered `repository` (`local`: `git init`) into
  `projects/<org>/<project>`, verified and registered, with `clone prepared: …` in
  `notes`; git clones into a temporary sibling directory with live progress (the Pi footer
  status, MCP progress notifications, CLI stderr lines prefixed "mypi: "), without a
  total time limit but stopped after 5 minutes without progress, and the result
  appears under projects/<org>/<project> only complete; Esc in Pi, cancelling the
  MCP call or SIGINT/SIGTERM of the CLI stops git, removes the partial clone and
  registers nothing, so the next /open prepares it again; without a `repository` it is refused before anything opens. A new session it starts (not a resumed
  or focused one) gets one start message in the frame `[mypi: стартовое сообщение
  для <key>. …]` through the same socket as events: for an organization the open
  tasks of each of its projects by status, for a project its code and identity,
  for a task its key and title, then a line asking to wait for directions or
  propose the next step; the rest is in the warmup. It is state, not an
  instruction, and creates no events. If it cannot be delivered, /open still
  succeeds with `start message not delivered: <reason>` in `notes`; for Claude in
  `bypassPermissions` delivery is not promised, as for events. `--message <text>`
  (one key; the caller must be its parent, else nothing opens) queues a parent
  message after the focus or start and delivers it live, after a resume or in the
  same message as the start text; `opened[].message` is its id.
- Remote mode (`server.json`, [M1-CLI](../M1-CLI.md#remote-mode)): the `sessions`
  and `events` rows live on the server; the registry
  `$XDG_RUNTIME_DIR/mypi/sessions` (macOS without the variable:
  `$TMPDIR/mypi/sessions`), sockets and transcripts stay on the device. A
  row's `device` is the `device` of `server.json`, else `os.hostname()`. A new
  session becomes active when this device has no other live record of the key; the
  server does not see other devices' registries. A sender claims only for the active
  session that is live in its own device's registry. In remote mode messages are taken by the
  active live session through its own subscription to `GET /v1/changes`, on any
  device: the Pi extension holds it (`mypi session subscribe --pid`, from
  `session_start` to `session_shutdown`) and so does Claude's stdio MCP process.
  Without an approved mypi MCP server in Claude, messages wait for the engineer's
  input, `/inbox` or the warmup. With the server unreachable the subscription
  reconnects after the stream's `retry`. A stream silent for 60 s (2.4 times the server's
  25 s keepalive), such as a half-open connection after sleep or a network switch, is
  dropped and reconnected the same way, and the reconnect claims what is pending. A takeover during a send can deliver twice
  (at least once): Pi drops ids it already showed, Claude may show a message twice. After a
  round that claimed events but delivered none (the socket refused or acknowledged
  nothing) the subscription waits the stream's `retry` before it claims again.
  `/open`, `sessions` and `task worktree` work from a device: data on the server,
  clones and worktrees on the device, under the mypi root by their relative paths
  ([remote mode](../M1-CLI.md#remote-mode)). `live` is known only for this
  device's sessions. On a device without its own sessions of the key `/open` starts a
  new one and notes `sessions of <KEY> on <devices> stay there; started a new one`.
