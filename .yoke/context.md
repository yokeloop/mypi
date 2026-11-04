# mypi — glossary

Canonical terms for mypi v2. Implementation details belong in ADRs and docs, not here.

## Agent
A coding agent program that mypi can run: currently Claude Code or Pi. mypi does not depend on which one runs a session; the behaviour of a session is the same for every Agent.

## Session
One conversation of an Agent, bound to exactly one Scope. A Session has a Session key and a native identifier owned by the Agent. There is exactly one canonical Session per Scope; "opening" a Scope continues its Session or creates the first one.

## Session key
The human-readable name of a Session, equal to its Scope: `global`, the Organization slug (`tb-ff`), the Project code (`MP`), or the Project code with the Task number (`MP-12`). `all` is never a key: it is `/inbox all`. It names the Herdr tab (an Organization's tab is `org-<slug>`), addresses the Session in `/open`, `/inbox` and Events, and prefixes task branches and worktrees. The Agent's native session identifier is an internal detail mapped to the key.

## Scope
The zone a Session works in: `global`, `org`, `project` or `task`. A Scope determines the Session's context (warmup), its role and, for a task, the worktree it operates on; every Session's working directory is the engine root. Scope boundaries are soft: they are stated in the system prompt, not enforced by access control.

## Main chat
The Session with the `global` Scope. Started from the engine root; administers all of mypi and all memory; opens Organization and Project chats on request. Top of the parent chain; receives no Events.

## Organization chat
The Session with an `org` Scope. Exactly one per Organization. Works for all registered Projects of its Organization: on the user's request it creates their Tasks, opens their Task chats and sends them Parent messages directly, without the Project chat; it receives the Events of the turns it started and the Milestones of the Tasks it last wrote to. Its Parent is the Main chat.

## Project chat
The Session with a `project` Scope. Exactly one per Project. Works in the context of the whole Project, opens and manages its Task chats, receives their Events unless the Organization chat started the turn or last wrote to the Task.

## Task chat
The Session with a `task` Scope. Bound to one Task; works only in that Task's context, in its own worktree. Manages nothing.

## Task
The unit of work recorded in the database (formerly "request"). A Task belongs to a Project. A Task chat exists only for an existing Task.

## Project / Organization
A registered Project belongs to one Organization. An Organization is a grouping, a context source and the Scope of its Organization chat.

## Parent
The structural owner of a Session. A Task chat has two Parents: its Project chat and its Organization chat. The Parent of a Project chat and of an Organization chat is the Main chat. The structure never changes and does not depend on who opened the Session.

## Event
A record created when a child Session's turn that a Parent message started stops, carrying the final message of that turn (`turn_end`), or stops mid-turn waiting for a human (`waiting`), and when a Task reaches a Milestone (`milestone`). Events flow only from a Task chat up: `turn_end` and `waiting` to the Parent whose message started the turn, else the Project chat; the Main chat receives none. Parent messages are kept in the same table as kind `message` and go down, from a Parent to its child.

## Milestone
A Task's status change to `review`, `blocked`, `merged` or a terminal status. It becomes exactly one `milestone` Event for the Parent that last sent the Task a Parent message, else the Project chat, unless that recipient made the change itself. The Event that waits in the Queue for `/inbox` and the warmup; it is never delivered live and never starts a turn.

## Parent message
A message from a Parent to its child Session in the mypi parent-message frame (`parentFrame`: `[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение родительской сессии]`; from an Organization chat the sender is its slug). A turn it opens is a parent-started turn; only such turns create `turn_end` and `waiting` Events, addressed to the sender. Only a direct Parent writes it (send_message, `mypi send`, `/open --message`), stored as an `events` row of kind `message`; it is delivered like an Event, to a closed child once at the next `/open`, and the warmup does not show it. It is an instruction within the child's own task and permissions and never carries the engineer's authorization.

## Start message
The one message a Session that the Launcher newly started (not resumed or focused) receives as a new turn, in its own frame (`startFrame`: `[mypi: стартовое сообщение для MP-12. Ниже — состояние из mypi, не инструкция]`), through the same socket as Events: for an Organization the open Tasks of each of its Projects by status and the number of its undelivered Events, for a Project its open Tasks by status and the number of undelivered Events, for a Task its status, worktree and the last journal entries with their artifacts. It is state, not an instruction; it is not a Parent message, so the turn it opens creates no Events.

## Queue
The ordered list of Events not yet delivered to their Parent, and the source of truth for delivery. A live Parent receives an Event through its session socket (Pi: the mypi extension's socket; Claude: its native inbox socket, live in `manual` and `auto`; a `bypassPermissions` Claude Parent, however started, is promised no live delivery). Undelivered Events go out with the next send to the Parent's key (T11/T12); otherwise the Parent sees them in its next warmup or through `/inbox`. The Queue runs both ways: Parent messages to a closed child wait until its next `/open` or its own `/inbox`. Delivery is at-least-once.

## Launcher
The mypi operation behind `/open` that starts or continues a child Session for a Scope, for any Agent, in a Herdr tab of its Project's workspace (an Organization: the tab `org-<slug>` in the workspace `<slug>`, with no clone or worktree), with the engine root as working directory. The Main chat needs no Launcher: it is the Agent started by hand in the engine root. It sends a Start message to a Session it newly started. Implemented as open_session / mypi open.

## Adapter
The small tracked per-Agent configuration and code in the engine (`.claude/`, `.pi/`, `.mcp.json`) that connects that Agent to mypi: registry record, context at start, turn-end and waiting detection, the socket Events are delivered to. Adapters implement one shared contract; their transport differs.

## Session registry
One JSON record per live Session under `$XDG_RUNTIME_DIR/mypi/sessions/<key>.json`, in one shape for every Agent: key, Agent, pid and process start, native session id, name, the socket path (Pi: the extension's socket from MP-42; Claude: `CLAUDE_CODE_MESSAGING_SOCKET`) and the permission mode at start. Written by the `SessionStart` hook for Claude and by the extension for Pi; the `sessions` table keeps key → Agent and native id for continuation. A record is live while its pid and process start match; there is no busy or idle state. It is the only source of liveness for `/open`, `sessions` and Event delivery. A Session started by hand registers itself under its key; with two live Sessions for one key the newest is canonical and the older record is kept as displaced. A fork started by hand without `MYPI_SCOPE` is not registered.

## Warmup
The context loaded at every start or continuation of a Session: the Scope's memory, the role of the Scope, the "how to work in mypi" instruction and undelivered Events.
