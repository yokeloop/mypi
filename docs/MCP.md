# mypi MCP

Local stdio server in the same package, sharing the typed application API with CLI.
No HTTP daemon or session orchestrator. [Implementation evidence](MCP-CYCLE.md).
Development guidance: [AGENTS](../AGENTS.md). The former mandatory agent workflow
is [withdrawn](AGENT-WORKFLOW.md); the server supplies no workflow instructions.
The [original MCP plan](MCP-PLAN.html) is historical, including its user-global setup.

## Start

```sh
timeout --kill-after=5s 295s mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- node dist/src/mcp/main.js
```

The last command waits for JSON-RPC on stdin, not interactive input. Bin: `mypi-mcp`.
Node 24; exact dependency versions are in package.json and pnpm-lock.yaml.
DB uses the server's XDG_STATE_HOME (fallback ~/.local/state); home is inside the
engine clone. Neither location depends on the client cwd. Connect/tools/list do not
initialize storage. Bootstrap and restore are CLI-only, require explicit intent and no other writers.

## Claude Code connection

The tracked `.mcp.json` registers this server as `mypi` for Claude Code started in
the engine root; its tools appear as `mcp__mypi__<tool>`, and `.claude/settings.json`
allows exactly them (a fast test compares the list). Claude asks once to approve the
project server. The `warmup` tool takes no character budget; only the CLI hook does.

## Pi connection

Pi sessions started in the engine checkout get the server from the tracked
extension `.pi/extensions/mypi.ts` after project trust ([README](../README.md#pi)).
It registers `node dist/src/mcp/main.js` with the engine root as cwd and the Pi
session id in `PI_SESSION_ID`, with codemode exposure and projects and warmup
direct. It installs no agent workflow, task-registration requirement, automatic
logging, delegation or Herdr-tab rule. A same-name entry in a Pi `mcp.json`
replaces the registration. Exposure makes tools available, not mandatory.
Connecting the server neither creates storage nor launches work.

After an authorized configuration change, `/reload` reloads Pi context/settings;
`/mcp reconnect mypi` reconnects the server after rebuilding it. An existing
conversation can retain old instruction text; a fresh session avoids that stale
context. `pi mcp list` connects to all enabled servers and is not an isolated
verification command. See the installed Pi MCP/security documentation for setup.

## Tool and transport contract

14 tools are available through standard tools/list: warmup, task_list, task_show, task_create, task_update, memory, note, journal, context_read, context_write, projects, sessions, open_session and inbox. Inspect live schemas for fields. Maintenance — db init, bootstrap, backup and its publication, restore, journal import, the status dictionary, context restore, home migrate-tasks and task worktree — is CLI-only ([M1-CLI](M1-CLI.md)); over MCP these names are unknown tools.
`memory` and `projects` take `action`, `note` takes `kind`, plus that action's fields; a field of another action is rejected. `task_update` runs its parts as the CLI's task status, title and progress commands (or touch alone) in that order within one serial slot; a failure after an earlier part saved returns `partial` with the saved and missing parts, a failure of the first part is a plain error. A status change to review, blocked, merged or a terminal status queues a milestone event for the project chat (inbox, warmup), unless the caller is the project chat itself (its registered key, else `MYPI_SCOPE`, as for `warmup`); milestones never start a turn.
Arguments are strict, including nested fields. Context scopes: global/org/project;
task scope is supported for journal, not MEMORY; warmup takes a scope key string (below). Journal read also accepts
explicit `"all"`. A project scope key is its code; task_create.project is org/project
(required; standalone REQ records are legacy). Do not invent an org/task reassignment command.
TextInput is exactly `{text}` or `{file:absolutePath}`; BOM/CRLF are preserved.
Context paths are home-relative; progress artifact paths are task-directory-relative.

Success: `{status:"ok",data:...}`. Tool error: `isError:true` and
`{status:"error",message}`. Partial includes status/message/saved/missing/paths and
taskId when known. structuredContent equals parsed JSON in text content. The data
payload retains CLI JSON shapes. `memory` show includes SHA-256 `revision`; `memory` remove requires `number` and `expectedRevision` for that exact file.
`warmup` takes optional `scope`: `global`, a project code or a task key; without it the
key registered for this session (the row for the session id in the server's environment,
else the live record of the server's parent process), else the server's `MYPI_SCOPE`,
else `global`. Its data is the Markdown text the CLI prints
(sections, order and the 64 KiB memory rule: ARCHITECTURE §5). In a project scope it includes
the undelivered events of the project's tasks and marks the ones shown in full delivered, plus
the last delivered `turn_end` of each open task as history; so `warmup` is not read-only.
`inbox` takes optional `key`: a project code or `"all"`, default as for `warmup`; it returns
`{ events: [{ id, from, to, kind, createdAt, text }] }` (`kind`: `turn_end`, `waiting` or `milestone`) with the undelivered events, each `text`
in its frame with the event number, and marks them delivered. Global and task keys return an
empty list; an unknown project is an error. There is no read-only preview.
`sessions` returns `{ tree }`: global → projects → tasks, each node `{ key, session: { agent, nativeId, state: live|closed } | null, children }`. Registration, unregistration and forgetting are CLI-only.
`open_session` takes keys (project code, CODE-N, org/project, org/project#N), optional agent and permissionMode; it returns `{ opened: [{ key, agent, action: focused|resumed|started, workspaceId, tabId, worktreePath, notes }] }` or a partial result naming opened and unopened keys. It needs a running Herdr server.
`journal` global remains global-only. CLI `project resolve /absolute/path`
exposes the same operation as projects action resolve. Invalid JSON-RPC remains an SDK protocol error;
well-formed tools/call validation failures/unknown names use the application envelope.
Backup, its publication and restore are CLI operations; see [M1-CLI](M1-CLI.md).
Always check isError and structuredContent.status, not promise resolution alone.

Calls within one server are serial; the parts of one task_update share one slot. A queued cancellation
does not write; an active synchronous call does not promise rollback. EOF/SIGTERM
stop new work, cancel queued work and drain active work. Forced termination requires
reconciliation. CLI/MCP share interprocess transaction guards; a JSON-RPC ID is not
an idempotency key. Never blindly repeat create/append after an unknown outcome.

Scope is not an ACL. The server runs with local user permissions; file/checkout/backup
arguments can reference explicit external paths. No arbitrary SQL/shell tool is exposed.
Read-only hints are not authorization; writes are not declared idempotent, and backup,
warmup and inbox are not read-only. Responses are not truncated by the server.

## Rollback

For a local setup, remove only its mypi entry/installed instruction block, then reload.
Do not remove global settings without permission. This does not delete DB/home.
Revert code with its matching lockfile and rebuild if authorized; saved user data does
not roll back automatically. See [M1-CLI](M1-CLI.md) for partial reconciliation.
