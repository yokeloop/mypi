# mypi MCP

Local stdio server in the same package, sharing the typed application API with CLI; `mypi serve` also serves a remote subset over Streamable HTTP at /mcp ([below](#remote-mcp-over-http)). No session orchestrator. [Implementation evidence](MCP-CYCLE.md).
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
direct. Every turn it also adds a codemode guideline that `searchTools()`,
`describeTool()` and `describeNamespace()` return Promises to be awaited. It
installs no agent workflow, task-registration requirement, automatic
logging, delegation or Herdr-tab rule. A same-name entry in a Pi `mcp.json`
replaces the registration. Exposure makes tools available, not mandatory.
Connecting the server neither creates storage nor launches work.

After an authorized configuration change, `/reload` reloads Pi context/settings;
`/mcp reconnect mypi` reconnects the server after rebuilding it. An existing
conversation can retain old instruction text; a fresh session avoids that stale
context. `pi mcp list` connects to all enabled servers and is not an isolated
verification command. See the installed Pi MCP/security documentation for setup.

## Tool and transport contract

15 tools are available through standard tools/list: warmup, task_list, task_show, task_create, task_update, memory, note, journal, context_read, context_write, projects, sessions, open_session, send_message and inbox. Inspect live schemas for fields. The remote /mcp endpoint offers a narrower subset ([below](#remote-mcp-over-http)). Maintenance — db init, bootstrap, backup and its publication, restore, journal import, the status dictionary, context restore, project and organization removal, home migrate-tasks and task worktree — is CLI-only ([M1-CLI](M1-CLI.md)); over MCP these names are unknown tools.
`memory` and `projects` take `action`, `note` takes `kind`, plus that action's fields; a field of another action is rejected. `task_update` runs its parts as the CLI's task status, title, parent and progress commands (or touch alone) in that order within one serial slot; `parent` (a task key of the same project, or `null` to clear) needs a reason like status and title and is refused for another project, the task itself or a cycle; a failure after an earlier part saved returns `partial` with the saved and missing parts, a failure of the first part is a plain error. A status change to review, blocked, merged or a terminal status queues one milestone event (inbox, warmup) for the parent that last sent the task a message, else the project chat, unless the caller is that recipient itself (its registered key, else `MYPI_SCOPE`, as for `warmup`); milestones never start a turn.
Arguments are strict, including nested fields. Context scopes: global/org/project;
task scope is supported for journal, not MEMORY; warmup takes a scope key string (below). Journal read also accepts
explicit `"all"`. A project scope key is its code; task_create.project is org/project
(required; standalone REQ records are legacy). Do not invent an org/task reassignment command.
TextInput is exactly `{text}` or `{file:absolutePath}`; BOM/CRLF are preserved.
Context paths are home-relative; progress artifact paths are task-directory-relative.
`context_read` takes an optional `revision` (full home commit SHA) to read the version a
`{path, commit}` journal artifact points at.

Success: `{status:"ok",data:...}`. Tool error: `isError:true` and
`{status:"error",message}`. Partial includes status/message/saved/missing/paths and
taskId when known. structuredContent equals parsed JSON in text content. The data
payload retains CLI JSON shapes. `memory` show includes SHA-256 `revision`; `memory` remove requires `number` and `expectedRevision` for that exact file.
`warmup` takes optional `scope`: `global`, an organization slug, a project code or a task key; without it the
key registered for this session (the row for the session id in the server's environment,
else the live record of the server's parent process), else the server's `MYPI_SCOPE`,
else `global`. Its data is the Markdown text the CLI prints
(sections, order and the 64 KiB memory rule: ARCHITECTURE §5). In a project scope it includes
the undelivered events of the project's tasks and marks the ones shown in full delivered, plus
the last delivered `turn_end` of each open task as history.
A project scope also carries a «Журнал» line (entries of the project and its tasks, newest date) and a task scope the task's last five journal entries; both end with the `journal` call that reads more.
An organization scope shows global and organization memory, one line per project of the
organization and, in the same way, the events addressed to the organization; so `warmup` is not read-only.
`inbox` takes optional `key`: an organization slug, a project code, a task key or `"all"`, default as for `warmup`; it returns
`{ events: [{ id, from, to, kind, createdAt, text }] }` (`kind`: `turn_end`, `waiting`, `milestone` or `message`) with the undelivered rows, each `text`
in its frame, and marks them delivered. A task key returns its parent's messages (`kind` `message`, in the parent frame), a project or organization key the events addressed to it and
the main chat's messages to it; `"all"` skips messages. The global key returns an empty list; an unknown key is an error. There is no read-only preview.
`send_message` takes `key` and `text`: the calling session's key, resolved as for `warmup` (its registered key, else `MYPI_SCOPE`, else `global`; an unresolved caller
therefore counts as global and may send only to projects and organizations), must be the key's direct parent (for a task its project or its organization, global for a project or an organization), otherwise it
is refused and nothing is written. It stores an `events` row of kind `message` and sends it at once to a live child in the
frame `[mypi: сообщение родительской сессии <parent> для <key>. …]`; a closed child gets it exactly once at the next `/open`. Result: `{ message, delivered }`.
An instruction never stands in for the user's word.
`sessions` returns `{ tree }`: global → organizations → projects → tasks, each node `{ key, session: { agent, nativeId, state: live|closed } | null, children }`. Registration, unregistration and forgetting are CLI-only.
`open_session` takes keys (organization slug, project code, CODE-N, org/project, org/project#N), optional agent, permissionMode and message (one key; the caller must be its parent, as for `send_message`): it returns `{ opened: [{ key, agent, action: focused|resumed|started, workspaceId, tabId, worktreePath, notes, message }] }` or a partial result naming opened and unopened keys. Each new tab opens in its project's Herdr workspace (label `org/project`), which is created when missing; an organization gets the tab `org-<slug>` in the workspace `<slug>`, with no clone or worktree. `global`, `all`, an unknown organization and an organization without registered projects are refused. A new session (action `started`) gets one start message in the frame `[mypi: стартовое сообщение для <key>. …]` through the same socket as events: for an organization the open tasks of each of its projects by status and the number of its undelivered events, for a project its open tasks by status and the number of undelivered events, for a task its status, worktree and the last journal entries with their artifacts. It is state, not an instruction, and creates no events; if it cannot be delivered, the key's `notes` say `start message not delivered: <reason>` and the call still succeeds. For Claude in `bypassPermissions` delivery is not promised. A `message` is queued after the focus or start (`message` is its id, else null), sent live to a focused session, and otherwise delivered with the queued messages after a resume or in the same message as the start text; undelivered ones stay queued with a note. A project without a clone is first cloned from its registered `repository` (`local`: `git init`) into `<engine>/projects/<org>/<project>`, verified and registered; its keys' `notes` say `clone prepared: …`, and without a `repository` it is refused before anything opens. With a progressToken the call sends notifications/progress with a message per clone progress line (at least every 10 s while git runs); cancelling the request stops git and registers nothing. It needs a running Herdr server.
`projects` action `add` takes an optional `repository` (a Git remote URL — https://, ssh://, file://, [user@]host:path or an absolute path — or `local`); `update` takes `checkoutPath` with `expectedCheckoutPath` and/or `repository` with `expectedRepository` (the exact previous value or null) and changes both in one transaction; `list` and `resolve` return `repository`. add and update write the DB only; only `open_session` clones.
`journal` global remains global-only. CLI `project resolve /absolute/path`
exposes the same operation as projects action resolve. `projects` action `flow`
(`project`: a code or org/project) returns the project's branch flow from
`home/projects/<org>/<project>/flow.json` with defaults and `source` `file|default`,
the same as CLI `project flow`; an invalid file is refused. Invalid JSON-RPC remains an SDK protocol error;
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

## Remote MCP over HTTP

`POST /mcp` is served by the `mypi serve` process ([HTTP API](HTTP-API.md)): the same
address, `--listen`, port and token file. Every request carries
`Authorization: Bearer <token>`; there is no OAuth.

- Stateless: there is no session and no `mcp-session-id`; every request is answered
  with one JSON body. `GET` and `DELETE` answer 405, so there is no server-to-client
  SSE stream. The client sends `Accept: application/json, text/event-stream` and
  `Content-Type: application/json`.
- Tools: a read token sees `task_list`, `task_show`, `journal`, `context_read` and
  `projects` (`list`, `flow`); a write token also sees `task_create`, `task_update`
  (without `artifacts`), `note` (only `kind: journal`) and `send_message`. A write
  called with a read token is refused with `This token is read-only`. Text inputs are
  `{text}` only. There is no `warmup`, `inbox`, `sessions`, `open_session`, `memory`,
  `context_write`, `projects` add/update/resolve or maintenance.
- The web session cookie (MP-72) is not accepted on `/mcp`: only the `Authorization`
  header authorizes. Only `authorization`, `accept`, `content-type` and
  `mcp-protocol-version` are passed to the MCP handler.
- The caller is the token's `sender`: `send_message` and status changes are made as
  that key; `MYPI_SCOPE` and the server's session are never used. Results use the same
  `{status, data}` envelope as the local server.
- A remote agent gets no warmup, so the `task_create` description carries the rules:
  register tasks only on the user's explicit request, one per independent problem.
- Errors before MCP work are JSON-RPC: 401 with `WWW-Authenticate: Bearer realm="mypi"`,
  405 with `Allow: POST`, 500 `API token file is unreadable`.

Claude Code:

```sh
claude mcp add --transport http mypi-remote http://<IP>:8737/mcp --header "Authorization: Bearer <token>"
```

Check with curl:

```sh
H=(-H 'accept: application/json, text/event-stream' -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN")
curl -s -X POST http://127.0.0.1:8737/mcp "${H[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s -X POST http://127.0.0.1:8737/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

## Rollback

For a local setup, remove only its mypi entry/installed instruction block, then reload.
Do not remove global settings without permission. This does not delete DB/home.
Revert code with its matching lockfile and rebuild if authorized; saved user data does
not roll back automatically. See [M1-CLI](M1-CLI.md) for partial reconciliation.
