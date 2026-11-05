# HTTP API

`mypi serve` is an optional REST/JSON server over the same application commands as
the CLI and the stdio MCP server. It runs in the foreground; the engine never starts
it on its own. Every route lives under `/v1`.

## Start and stop

```sh
mypi token create phone --permission read
mypi serve [--listen <IP>] [--port <n>]
```

- Without flags it listens on `127.0.0.1:8737`. `--port 0` picks a free port.
- When it is ready it prints one line to stdout:
  `{"status":"listening","url":"http://127.0.0.1:8737"}` (the real port after `--port 0`).
- SIGINT or SIGTERM (Ctrl+C) stops it with exit code 0: change streams are closed and
  the port is released.
- `mypi serve` validates its arguments and runs the server as a child process,
  `node dist/src/http/main.js`, so other CLI commands never load the HTTP server or
  the MCP SDK. SIGINT and SIGTERM are forwarded to it, and
  a second delivery (Ctrl+C reaches the whole process group) is harmless. The CLI exits
  with the child's exit code; a child killed by a signal gives 128 + the signal number.
- It refuses to start without any API token, without an initialized database, or
  with a database schema other than the one the engine expects (12).

## Network

- The server binds only to loopback unless `--listen <IP>` names another address,
  for example the machine's Tailscale IP. `--listen` takes one IP address, not a host
  name. `0.0.0.0` is accepted but exposes the API on every interface; avoid it.
- There is no TLS in the process. Encryption comes from the network it is exposed on
  (Tailscale). Never publish the port to the internet.
- No CORS headers are sent; browsers on other origins cannot call it.

## Tokens

```sh
mypi token create <name> --permission read|write [--sender global|CODE]
mypi token list
mypi token revoke <name>
```

- Tokens live in `$XDG_CONFIG_HOME/mypi/api-tokens.json` (`~/.config/mypi/…` without
  `XDG_CONFIG_HOME`), a private file (0600, directory 0700) that keeps only SHA-256
  hashes. A symlink or a file readable by others is refused.
- `create` prints the token value (`mypi_…`) once; it cannot be shown again.
  `list` shows names, permissions, senders and creation times, never hashes.
- Every request sends `Authorization: Bearer <token>`; a browser sends the
  `mypi_session` cookie instead (see [Web UI](#web-ui)). The file is read on every
  request, so `revoke` takes effect at once, without a restart; open `/v1/changes`
  streams of a revoked token, over the header or the cookie, end within one poll tick
  (about 1 s).
- The `mypi_session` cookie is accepted only when there is no `Authorization` header
  (the header wins) and only for reads: a write route answers 403 `forbidden`, even
  for a write token. An unknown or revoked cookie answers 401 and clears the cookie.
- `read` tokens only read; `write` tokens also write. A write token has a `sender`
  (default `global`): the session key on whose behalf `POST /v1/messages` and status
  changes run. The parent rule applies as everywhere: `global` may send only to
  projects, a project only to its own tasks. A status change made with a project's
  sender queues no milestone for that project, as in its project chat.

## Envelope and errors

Every JSON response is `{ "apiVersion": 1, "data": … }` or
`{ "apiVersion": 1, "error": { "code": …, "message": … } }`.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | Unknown or repeated query parameter, bad value, unknown or missing body field, unknown task or project, any refused input |
| 400 | `invalid_request` | A request target that cannot be parsed as a URL (logged with path `-`) |
| 400 | `invalid_json` | The body is not JSON |
| 401 | `unauthorized` | Missing or unknown bearer token or session cookie (checked before routing) |
| 403 | `forbidden` | A write route with a read token or a browser session cookie |
| 404 | `not_found` | Unknown path |
| 405 | `method_not_allowed` | Known path, other method |
| 413 | `payload_too_large` | Body over 1 MiB |
| 415 | `unsupported_media_type` | A write without `Content-Type: application/json` |
| 500 | `partial` | A multi-part update saved some parts; `error.saved` and `error.missing` list them |
| 500 | `internal` | An unreadable or invalid token file, with the fixed message `API token file is unreadable`; anything else with the engine's message (for example a database that needs a restart after a migration) |

An unknown task is a 400, not a 404: 404 means only an unknown route.

## Routes

A task key is `CODE-N` (`MP-12`), a project code is `CODE` (`MP`).

| Method and path | Permission | Command | `data` |
|---|---|---|---|
| `GET /v1/info` | read | — | `{ version, schemaVersion, changeId, instance }` |
| `GET /v1/session` | read | — | `{ name, permission, via }`, `via` is `bearer` or `cookie` |
| `POST /v1/session` | none | — | body `{ token }` → `{ name, permission }` and the `mypi_session` cookie; 401 `Unknown token` |
| `DELETE /v1/session` | none | — | `Content-Type: application/json` required → `{ loggedOut: true }`, the cookie is cleared |
| `GET /v1/changes` | read | — | SSE stream, see below |
| `GET /v1/projects?org` | read | `project_list` | `{ items: project[] }` |
| `GET /v1/projects/{CODE}/flow` | read | `project_flow` | `flow` |
| `GET /v1/tasks?project&status&q&cursor&limit` | read | `task_page` | `{ items: task[], next }` |
| `GET /v1/tasks/{KEY}` | read | `task_show` | `task` |
| `POST /v1/tasks` | write | `task_create` | `task`, status 201 |
| `PATCH /v1/tasks/{KEY}` | write | `task_status`, `task_title`, `task_parent`, `task_progress`, `task_touch`, then `task_show` | `task` |
| `GET /v1/events?to&from&kind&delivered&q&cursor&limit` | read | `event_list` | `{ items: event[], next }` |
| `GET /v1/journal?scope&from&to&type&q&cursor&limit` | read | `journal_page` | `{ items: journal[], next }` |
| `POST /v1/journal` | write | `journal_add` | `{ id }`, status 201 |
| `POST /v1/messages` | write | `message_send` | `{ id, delivered }`, status 201 |
| `GET /v1/sessions` | read | `sessions` | `session` (the root of the tree) |
| `GET /v1/context?path&revision` | read | `context_read` | `context` |
| `POST /mcp` | read or write, by token | MCP JSON-RPC (Streamable HTTP, stateless, JSON responses) | see [docs/MCP.md](MCP.md#remote-mcp-over-http) |

Errors of `/mcp` are JSON-RPC (`401` with `WWW-Authenticate: Bearer`, `405` on
`GET`/`DELETE`, `500` `API token file is unreadable`), not the `{apiVersion}` envelope.

Query details:

- `project` takes a code or `org/project`; `status` a status code.
- `delivered` is `true` or `false`; `kind` one of `turn_end`, `waiting`, `milestone`,
  `message`; the journal's `type` one of `note`, `task_created`, `status_changed`; its
  `from`/`to` are UTC timestamps; its `scope` is a scope reference as in the CLI's
  `journal -s`: `global`, an org slug, `org/project`, or `type:key` such as
  `project:FX`, `task:FX-1` or `org:fx`; all scopes by default. A bare `FX` or
  `FX-1` is refused.
- `revision` is a full 40- or 64-hex commit.
- Empty values are ignored; any parameter not listed for the route is refused.

Bodies are JSON objects; every field is a string unless noted, unknown fields are
refused:

- `POST /v1/tasks`: `project`, `title`, `status`, `slug`, `source` (the exact source
  text), optional `parent` (the key of a parent task of the same project). No file
  sources, no `adoptSource`.
- `PATCH /v1/tasks/{KEY}`: `status`, `title`, `parent` (a task key or `null` to
  clear), `reason`, `progress`, `touch` (only `true`). At least one of status, title,
  parent, progress, touch; `reason` is required with status, title or parent and
  refused without them; `touch` only alone. Parts apply in the order status, title,
  parent, progress, touch; progress carries no artifacts.
- `POST /v1/journal`: `scope`, `text` (a note). `scope` takes the same references
  as the journal query (`global`, an org slug, `org/project`, `project:FX`,
  `task:FX-1`).
- `POST /v1/messages`: `to`, `text`; sent from the token's `sender`.

Response shapes:

- `project`: `{ code, org, slug, identity, repository, checkoutPath }`
- `flow`: `{ project, code, source, integration, taskBranch, prTarget, mergeMethod, release }`
- `task`: `{ key, project, number, title, parent, status, isTerminal, contextDir, worktreePath, createdAt, updatedAt }`
  (`parent` is the key of the parent task or `null`)
- `event`: `{ id, from, to, kind, text, createdAt, deliveredAt }`
- `journal`: `{ id, at, scope: { type, key? }, type, text, artifacts: [{ path, commit }] }`
  (`commit` is `null` for historical path-only artifacts)
- `session`: `{ key, session: { agent, nativeId, state } | null, children: session[] }`
- `context`: `{ path, revision, text }`

Reading events never marks them delivered; `/inbox` and the warmup work as before.

## Pages and search

Tasks, events and the journal come newest first by id. `limit` is 1-200 (default 50).
`next` is an opaque cursor or `null`; pass it back as `cursor` for the following
page. `q` is a case-insensitive substring: tasks match key and title, events and
journal entries their text. Projects, sessions, flow and context are not paged.

## Changes

The server keeps one read-only database connection and checks
`PRAGMA data_version` once a second. Each change committed by anyone (CLI, MCP,
agents, this server) increments `changeId`, a counter kept in the server process.

- `GET /v1/info` returns the current `changeId` and the server's `instance` id.
- `GET /v1/changes` is a Server-Sent Events stream. It sends the current value at
  once and then one event per change:

  ```text
  retry: 2000
  id: 7
  event: change
  data: {"changeId":7}
  ```

  A `: keepalive` comment follows every 25 s.
- Clients reread what they show when an event arrives. `changeId` is monotonic only
  within one process: when `instance` changes, the server restarted and the client
  rereads everything.

## Stability

`apiVersion` is 1. New fields and routes may appear in `/v1`; removing or renaming a
field or route needs `/v2`.

## Engine updates and migrations

The server opens a database of schema 13 and keeps its code in memory. After an
engine update or a migration, restart it.

## Access log

One line per request on stderr:

```text
2026-11-03T10:00:00.000Z GET /v1/tasks 200 phone
```

Time, method, path without the query, status and the token's name (`-` when no
token was accepted). Token values, query strings, headers and bodies are never
logged. An unparseable request target is logged with path `-`. When the token file
cannot be read, its raw error (with the file's path, never a token value) is written
as a separate stderr line: once per request, and at most once per poll tick while
change streams are checked.

Requests to /mcp are logged the same way, with path /mcp.

## systemd user unit (example)

Not installed automatically. `~/.config/systemd/user/mypi-api.service`:

```ini
[Unit]
Description=mypi HTTP API

[Service]
ExecStart=<node24> <engine>/dist/src/cli/main.js serve --listen <tailscale-ip>
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```sh
systemctl --user enable --now mypi-api
```

Add `Environment=XDG_STATE_HOME=…` or `Environment=XDG_CONFIG_HOME=…` when the state
or the token file is not at the defaults.

## Web UI

The same `mypi serve` serves a read-only browser interface at
`http://<listen>:<port>/` (`http://127.0.0.1:8737/` by default).

- Sign in by pasting a token (read or write; in the browser both only read).
  `POST /v1/session` sets the cookie
  `mypi_session=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`; page
  scripts never see the token afterwards. Logout (`DELETE /v1/session`) clears it, and
  `mypi token revoke` ends the session at the next request.
- `Secure` is added only when the request carries `X-Forwarded-Proto: https` from an
  HTTPS proxy (for example `tailscale serve`). Over plain http through Tailscale the
  cookie has no `Secure`: the tunnel encrypts, and with `Secure` the browser would not
  send the cookie back over http.
- CSRF: writes over the cookie are refused, login and logout require
  `Content-Type: application/json`, which a cross-site form cannot send, and there is
  no CORS.
- Static files: exact paths of `dist/ui`; any other path without an extension
  outside `/assets/` falls back to `index.html` (client routes), while `/assets/*`
  and paths with an extension that do not exist are 404. Hashed `/assets/*` are cached
  for a year (`immutable`), everything else is `no-cache`; `index.html` carries a
  Content-Security-Policy (`default-src 'self'`, inline styles only) and
  `X-Frame-Options: DENY`. Static requests are logged with token `-`.
- `dist/ui` is read once at startup: restart `serve` after `pnpm build`.
- Screens: projects (with their flow), tasks, events and the journal, each with
  filters kept in the URL, search (`q`) and a cursor "Load more". The UI rereads what
  it shows on every `/v1/changes` event (a Live/Offline badge shows the stream), and
  a Refresh button rereads on demand. Unknown fields and values are shown as they
  come. The layout works down to phone width.
- Development: `mise exec -- pnpm --filter mypi-web dev` starts Vite with a proxy of
  `/v1` to `127.0.0.1:8737`.

## Extension points

`src/http/serve.ts` dispatches by path prefix through `mounts`: `/v1/` (the API), `/mcp` (the remote MCP endpoint, [MCP](MCP.md#remote-mcp-over-http), same tokens and access log) and `/` (the web UI, MP-72), which stays last and catches every other path.
