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
initialize storage. Bootstrap/restore require explicit intent and no other writers.

## Optional Pi connection

The [example](../integrations/pi/mcp.example.json) describes the mypi server only.
It does not install an agent workflow, memory warmup, task-registration requirement,
automatic logging, delegation or Herdr-tab rule. The former
[instruction template](../integrations/pi/mypi-instructions.md) is retired.

For an explicitly requested connection, the mypi entry can be merged into the
chosen Pi MCP configuration using absolute Node 24 and built entrypoint paths.
Unrelated servers/settings and existing credentials are not part of that change.
Project settings load after trust; a project entry replaces a global entry of the
same name. A second server is not needed to change metadata.

The example exposes project_resolve and warmup directly; other tools are available
through codemode. Exposure makes tools available, not mandatory. Connecting the
server neither creates storage nor launches work.

After an authorized configuration change, `/reload` reloads Pi context/settings;
`/mcp reconnect mypi` reconnects the server after rebuilding it. An existing
conversation can retain old instruction text; a fresh session avoids that stale
context. `pi mcp list` connects to all enabled servers and is not an isolated
verification command. See the installed Pi MCP/security documentation for setup.

## Tool and transport contract

31 tools are available through standard tools/list. Inspect live schemas for fields.
Arguments are strict, including nested fields. Context scopes: global/org/project;
request scope is supported for journal, not warmup or MEMORY. Journal read also accepts
explicit `"all"`. A project scope key is its code; request_create.project is org/project
or null (standalone REQ). Do not invent an org/request reassignment command.
TextInput is exactly `{text}` or `{file:absolutePath}`; BOM/CRLF are preserved.
Context paths are home-relative; progress artifact paths are request-directory-relative.

Success: `{status:"ok",data:...}`. Tool error: `isError:true` and
`{status:"error",message}`. Partial includes status/message/saved/missing/paths and
requestId when known. structuredContent equals parsed JSON in text content. The data
payload retains CLI JSON shapes. Invalid JSON-RPC remains an SDK protocol error;
well-formed tools/call validation failures/unknown names use the application envelope.
Always check isError and structuredContent.status, not promise resolution alone.

Calls within one server are serial, including async backup. A queued cancellation
does not write; an active synchronous call does not promise rollback. EOF/SIGTERM
stop new work, cancel queued work and drain active work. Forced termination requires
reconciliation. CLI/MCP share interprocess transaction guards; a JSON-RPC ID is not
an idempotency key. Never blindly repeat create/append after an unknown outcome.

Scope is not an ACL. The server runs with local user permissions; file/checkout/backup
arguments can reference explicit external paths. No arbitrary SQL/shell tool is exposed.
Read-only hints are not authorization; writes are not declared idempotent, and backup
is not read-only. Responses are not truncated by the server.

## Rollback

For a local setup, remove only its mypi entry/installed instruction block, then reload.
Do not remove global settings without permission. This does not delete DB/home.
Revert code with its matching lockfile and rebuild if authorized; saved user data does
not roll back automatically. See [M1-CLI](M1-CLI.md) for partial reconciliation.
