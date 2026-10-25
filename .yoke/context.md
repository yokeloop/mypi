# mypi — glossary

Canonical terms for mypi v2. Implementation details belong in ADRs and docs, not here.

## Agent
A coding agent program that mypi can run: currently Claude Code or Pi. mypi does not depend on which one runs a session; the behaviour of a session is the same for every Agent.

## Session
One conversation of an Agent, bound to exactly one Scope. A Session has a Session key and a native identifier owned by the Agent. There is exactly one canonical Session per Scope; "opening" a Scope continues its Session or creates the first one.

## Session key
The human-readable name of a Session, equal to its Scope: `global`, the Project code (`MP`), or the Project code with the Task number (`MP-12`). It names the Herdr tab, addresses the Session in `/open`, `/queue` and Events, and prefixes task branches and worktrees. The Agent's native session identifier is an internal detail mapped to the key.

## Scope
The zone a Session works in: `global`, `project` or `task`. A Scope determines the Session's context (warmup), its role and its working directory. Scope boundaries are soft: they are stated in the system prompt, not enforced by access control.

## Main chat
The Session with the `global` Scope. Started from the engine root; administers all of mypi and all memory; opens Project chats on request. Top of the parent chain.

## Project chat
The Session with a `project` Scope. Exactly one per Project. Works in the context of the whole Project, opens and manages its Task chats, receives their Events.

## Task chat
The Session with a `task` Scope. Bound to one Task; works only in that Task's context, in its own worktree. Manages nothing.

## Task
The unit of work recorded in the database (formerly "request"). A Task belongs to a Project. A Task chat exists only for an existing Task.

## Project / Organization
A registered Project belongs to one Organization. Organization is a grouping and a context source only; it has no Session of its own.

## Parent
The structural owner of a Session: Task chat → Project chat → Main chat. Parenthood never changes and does not depend on who opened the Session.

## Event
A record created every time a child Session's turn stops (finished, asked a question, stopped for any reason), carrying the final message of that turn. Events flow to the Parent.

## Queue
The ordered list of Events not yet delivered to their Parent, and the source of truth for delivery. A live Pi Parent receives an Event at once; a live Claude Parent receives it at its next turn boundary (MVP); a closed Parent sees it in warmup. Delivery is at-least-once.

## Launcher
The mypi operation behind `/open` that starts or continues a child Session for a Scope, for any Agent, in a Herdr tab, with the engine root as working directory. The Main chat needs no Launcher: it is the Agent started by hand in the engine root.

## Adapter
The small tracked per-Agent configuration and code in the engine (`.claude/`, `.pi/`, `.mcp.json`) that connects that Agent to mypi: context at start, turn-end detection, Event delivery. Adapters implement one shared contract; their transport differs.

## Session registry
One JSON record per live Session under `$XDG_RUNTIME_DIR/mypi/sessions/<key>.json`, in one shape for every Agent: key, Agent, pid and process start, native session id, status (busy/idle), and for Pi the socket path. Derived from `claude agents --json` for Claude and written by the extension for Pi; the only source of liveness for `/open`, `sessions` and Event delivery. A Session started by hand registers itself under its key; with two live Sessions for one key the newest is canonical.

## Warmup
The context loaded at every start or continuation of a Session: the Scope's memory, the role of the Scope, the "how to work in mypi" instruction and undelivered Events.
