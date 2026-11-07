# Sessions, /open and event delivery

Read when: working with session registration, /open, start messages, events, milestones or parent messages and their delivery.

## Events and parent messages

- On `agent_settled` (with the last reply) and on `ui_prompt_start` (`--waiting`)
  the [Pi extension](agent-integration.md#pi) runs
  `mypi event emit` with the registered key and `--to` the sender of that frame,
  only in a turn that a message in the mypi parent-message frame started through
  its socket; the event goes to that sender when it is a parent of the task, else
  to the task's project. From `session_start` to
  `session_shutdown` it holds `$XDG_RUNTIME_DIR/mypi/<key>-<pid>.sock` (0600),
  one socket per Pi process so a displaced session never removes the new one's,
  and registers its path; `mypi event emit` then sends all undelivered events of the
  parent except milestones to its live Pi session and marks the acknowledged ones delivered. Without a
  socket or an answer they wait for /inbox and the warmup; a displaced session
  silently stops receiving them. A live Claude parent gets them at once through
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

## Session registry and /open

- Both agents register their sessions: a row in the `sessions` table (key → agent
  and native id, kept for continuation) and a live record in
  `$XDG_RUNTIME_DIR/mypi/sessions/<key>.json` (owner-only; pid and process start,
  native id, name, socket, start permission mode). The key is resolved in one
  order: the row for this native id, the live record of the same process,
  `MYPI_SCOPE`, `global`. A newer live session under a key becomes canonical and
  the older record moves to `<key>~<pid>.json`. A fork started by hand without
  `MYPI_SCOPE` is not registered. `mypi sessions` (MCP `sessions`) shows the tree;
  `mypi session forget <key>` drops a row on the user's request. Without
  `XDG_RUNTIME_DIR` or an initialized schema 15 database registration fails and the
  warmup still runs. /open (MCP open_session, CLI mypi open) focuses a live
  session's Herdr tab or opens a new tab in its project's Herdr workspace (label
  org/project, created when missing; a task gets its tab there without starting
  the project session; an organization key, the bare slug `tb-ff`, gets the tab
  `org-<slug>` in the workspace `<slug>`, with no clone or worktree, and an
  organization without registered projects is refused) in the engine root with MYPI_SCOPE and starts or resumes
  the agent; it writes no session rows. A project without a clone is first cloned
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
  tasks of each of its projects by status and the number of its undelivered
  events, for a project its open tasks by status and the number of undelivered
  events, for a task its status, worktree
  and the last journal entries with their artifacts. It is state, not an
  instruction, and creates no events. If it cannot be delivered, /open still
  succeeds with `start message not delivered: <reason>` in `notes`; for Claude in
  `bypassPermissions` delivery is not promised, as for events. `--message <text>`
  (one key; the caller must be its parent, else nothing opens) queues a parent
  message after the focus or start and delivers it live, after a resume or in the
  same message as the start text; `opened[].message` is its id.
