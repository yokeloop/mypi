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
  with a database schema other than the one the engine expects (17).

## Network

- The server binds only to loopback unless `--listen <IP>` names another address,
  for example the machine's Tailscale IP. `--listen` takes one IP address, not a host
  name. `0.0.0.0` is accepted but exposes the API on every interface; avoid it.
- There is no TLS in the process. Encryption comes from the network it is exposed on
  (Tailscale). Never publish the port to the internet.
- No CORS headers are sent; browsers on other origins cannot call it.

## Tokens

```sh
mypi token create <name> --permission read|write|device [--sender global|CODE]
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
  projects and organizations, a project only to its own tasks. A status change
  queues a milestone for the parent that last sent the task a message, else the
  project chat, unless the sender is that recipient: a project's sender queues none
  for its own task unless the organization wrote to the task last, in which case
  the milestone goes to the organization.
- `device` is a device's token for the remote mode of the CLI and stdio MCP
  ([docs/M1-CLI.md](M1-CLI.md#remote-mode)); it has no `sender`. It is accepted on
  `POST /v1/ops` only, and only in the `Authorization` header: a cookie, a `read` or a
  `write` token there answers 403. On read routes and `/mcp` it acts as `read`. Never
  give it to a phone or a browser.
- An engine older than this release refuses the whole `api-tokens.json` when it holds
  a `device` entry, so every token fails: revoke `device` tokens before rolling the
  engine back.

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
| `POST /v1/ops` | device (bearer only) | the operation `op` | its result, see [Operations](#operations) |
| `POST /mcp` | read or write, by token | MCP JSON-RPC (Streamable HTTP, stateless, JSON responses) | see [docs/MCP.md](MCP.md#remote-mcp-over-http) |

Errors of `/mcp` are JSON-RPC (`401` with `WWW-Authenticate: Bearer`, `405` on
`GET`/`DELETE`, `500` `API token file is unreadable`), not the `{apiVersion}` envelope.

Query details:

- `project` takes a code or `org/project`; `status` a status code.
- `delivered` is `true` or `false`; `kind` one of `turn_end`, `waiting`, `milestone`,
  `message`; the journal's `type` one of `note`, `task_created`, `status_changed`,
  `title_changed`, `worktree_created`, `session_opened`, `message_sent`,
  `clone_prepared`; its `from`/`to` are UTC timestamps; its `scope` is a scope reference as in the CLI's
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
- `session`: `{ key, session: { agent, nativeId, state } | null, sessions: [{ agent, nativeId, device, activeAt, state }], children: session[] }`
  (`session` is the active session of the key, where the engineer wrote last; `sessions` lists every session of
  the key, last active first)
- `context`: `{ path, revision, text }`

Reading events never marks them delivered; `/inbox` and the warmup work as before.

## Operations

`POST /v1/ops` serves a device in remote mode. The body is `{ op, input, version }`:

- `op` is one of `project_list`, `project_add`, `project_update`, `project_resolve`,
  `project_remove`, `org_remove`, `status_list`, `status_add`, `status_rename`,
  `status_terminal`, `status_remove`, `task_list`, `task_show`, `journal_read`,
  `event_list`, `task_create`, `task_status`, `task_title`, `task_parent`, `task_touch`,
  `task_progress`, `journal_add`, `context_guard`, `context_base`, `session_key`,
  `session_save`, `session_forget_rows`, `session_activate`, `events_claim`,
  `events_settle`, `event_create`, `inbox_take`, `message_create`, `warmup_data`,
  `events_mark`, `open_snapshot`, `parent_check`, `session_open`, `worktree_record`,
  `checkout_record`, `archive_offset`, `archive_record`, `archive_status`, `archive_search`,
  `archive_show`, `archive_forget`; any other answers 400
  `invalid_request` `Unknown operation: <op>`.
- `input` holds the fields of the command of the same name, except `task_create` (no
  `source` and no `adoptSource`: the device writes `source.md`), `task_status` (`session`
  is only `{agent, nativeId}`; the server finds the caller by that session, else
  `envScope`) and `task_progress` (`artifacts` are paths relative to the task folder plus
  the home `commit`); `context_guard` `{paths?}` answers `{frozen, fingerprints}` and
  `context_base` `{scope} | {project}` answers `{path}` for the device's own home writes.
  The session and event operations have no command of the same name; they take the
  inputs of `SessionOperations` in `src/app/session-operations.ts` (`agent` and
  `nativeId` identities, keys and event ids, never a path, pid or runtime):
  `session_key` `{agent, nativeId}`; `session_save` `{agent, nativeId, device,
  candidateKey, fork, envScope?, otherLive, own}` (`candidateKey` may be `null`;
  `otherLive` and `own` are `{agent, nativeId, key}` lists from the device registry); `session_forget_rows`
  `{key}`; `session_activate` `{agent, nativeId, claim}`; `events_claim` `{key, live,
  messagesOnly?}` (`live` is a list of identities); `events_settle` `{sessionId, acked,
  released}`; `event_create` `{from, kind, message, to?}` (`kind` is `turn_end` or
  `waiting`); `inbox_take` `{key, caller}`; `message_create` `{from, to, message}`;
  `warmup_data` `{key}`; `events_mark` `{ids, caller}`. In `inbox_take` and
  `events_mark` `caller` is an identity or `null`. Opening from a device uses
  `open_snapshot` `{orgs}` (answers `{projects, cards, rows, orgs}`, `orgs` being the named
  organizations that exist); `parent_check` `{from, to}`; `session_open` `{agent, nativeId,
  key, device, opened?}` (`opened` is `{action: started|resumed, worktree}` and adds the
  `session_opened` journal entry); `worktree_record` `{key, worktreePath, created?}`
  (`created` is `{branch, base}` and adds `worktree_created`); `checkout_record`
  `{identity, checkoutPath, action, repository?}` (`action` is `cloned`, `initialized` or
  `adopted`; answers `{checkoutPath}` and adds `clone_prepared`). `worktreePath` and
  `checkoutPath` are paths on the device: the server stores them as text and never opens
  them.
  The archive operations are the archive's own API on the same `/v1/ops`:
  `archive_offset` `{agent, nativeId}`; `archive_record` `{agent, nativeId, path,
  expectedOffset, newOffset, read}`; `archive_status`, `archive_search`, `archive_show`
  and `archive_forget` take the fields of the command of the same name.
  A missing, mistyped or extra field answers 400 `invalid_request` and nothing runs. No
  input names a server path; context paths are only lookup keys and `archive_record.path`
  is a device label, the server never opens them.
- `version` must equal the server's engine version, else 409 `version_mismatch`
  `engine version <a> differs from server <b>`.

The server runs the operation in its own process as one SQLite transaction, without
queues or leases. The device sends project paths already canonicalized; the server
stores them as sent and never looks at its own filesystem for them. `data` is the
result in the engine's internal form, in the usual envelope. The session and event
operations serve the device's CLI, MCP and hooks; the session registry, sockets,
transcripts and the rendering of the warmup stay on the device.

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

  A `: keepalive` comment follows every 25 s. A `device` token reads it too: the live
  session of a device in remote mode is subscribed and calls `events_claim` on every
  change.
- Clients reread what they show when an event arrives. `changeId` is monotonic only
  within one process: when `instance` changes, the server restarted and the client
  rereads everything.

## Stability

`apiVersion` is 1. New fields and routes may appear in `/v1`; removing or renaming a
field or route needs `/v2`. The inputs and results of `/v1/ops` are internal and not
part of this promise: a device and its server run the same engine version.

## Engine updates and migrations

The server opens a database of schema 17 and keeps its code in memory. After an
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

## Server and devices

The database (`state.sqlite3`) and the archive (`archive.sqlite3`) live on one always-on
server that runs `mypi serve`; `home`, project clones, worktrees, the session registry,
sockets, Herdr and transcripts stay on each device. A device works in
[remote mode](M1-CLI.md#remote-mode), which says what goes to the server, what is refused and
how `server.json` is read. The session model is in
[sessions](agents/sessions.md#session-registry-and-open) and
[ADR 0006](../.yoke/adr/0006-many-sessions-per-scope.md).

### Server

- The server is an engine clone without `home`; `bootstrap` is not run there. Build it by
  `mise.toml`:

  ```sh
  git clone <engine-repository> <engine>
  cd <engine>
  mise install
  mise exec -- pnpm install --frozen-lockfile
  mise exec -- pnpm build
  ```

- Its database is either moved from a device ([Move to the server](#move-to-the-server)) or
  new (`mypi db init`; the same call is a no-op on the same schema).
- One `device` token per device: `mypi token create <device-name> --permission device`. It is
  printed once; its rights are in [Tokens](#tokens). Before rolling the engine back to an
  older version, revoke the `device` tokens as [Tokens](#tokens) describes.
- Network: `--listen <tailscale-ip>`; the port is never published to the internet
  ([Network](#network)).
- Unit: the [systemd user unit](#systemd-user-unit-example) example (it already has
  `serve --listen <tailscale-ip>`, `Restart=on-failure` and `Environment=` for non-default
  state and token paths). To keep the user unit running without a login:

  ```sh
  loginctl enable-linger
  systemctl --user enable --now mypi-api
  ```

- The server and every device run one engine version (otherwise
  `engine version <a> differs from server <b>`): update them together and restart the server
  after the update ([Stability](#stability),
  [Engine updates and migrations](#engine-updates-and-migrations)).

### Devices

- Each device has its own `home` (a clone of home's `origin`) and its own project clones
  through Git; there is no database on the device.
- `server.json` (0600) holds the `url`, the `device` token and the device name; its format and
  rules are in [remote mode](M1-CLI.md#remote-mode). Write it with:

  ```sh
  (umask 077; mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/mypi" &&
    printf '{"url":"%s","token":"%s","device":"%s"}\n' <url> <token> <device-name> \
      > "${XDG_CONFIG_HOME:-$HOME/.config}/mypi/server.json")
  ```

- Clone paths are recorded on the server and are the same on every device. On a new device,
  clone by hand with `git clone <repository> <path>` at the recorded path; until then
  `task worktree` and `open` answer with a hint naming that command
  ([remote mode](M1-CLI.md#remote-mode)).
- Rule: push `home` changes right after each commit; after switching to another device,
  `git pull` in `home` and in the task's clone or worktree before working.

### One scope on several devices

- A session of another device is not resumed: `/open` on this device starts a new one and
  writes `sessions of <KEY> on <devices> stay there; started a new one` to `notes`
  ([sessions](agents/sessions.md#session-registry-and-open)).
- On its first input the new session gets a pointer to the other session's work with
  "git pull first" ([sessions](agents/sessions.md#events-and-parent-messages)).
- The scope's messages are taken by the active live session through its subscription to
  `GET /v1/changes`, on any device
  ([ADR 0006](../.yoke/adr/0006-many-sessions-per-scope.md)).

### Limitations

- Server without `home`: `GET /v1/context` and MCP `context_read` answer 400
  `Missing context file`; `GET /v1/projects/{CODE}/flow` returns only defaults
  (`source: "default"`) and does not see the devices' `flow.json`; `POST /v1/tasks` and remote
  MCP `task_create` write `source.md` into a non-Git `home/` on the server that no device
  sees, so create tasks from a device (`mypi task create` or stdio MCP `task_create`). The
  other `/v1` routes and every `POST /v1/ops` work without `home`.
- `mypi backup` fails on a server without `home` (it takes a bundle of `home`); back the
  server up with `sqlite3 .backup` ([Backup timer (example)](#backup-timer-example)).
- Without the approved mypi MCP server in Claude there is no live delivery: messages wait for
  input, `/inbox` or warmup ([sessions](agents/sessions.md#session-registry-and-open)).
- Server unreachable: a device command exits with code 1 and
  `mypi server unreachable: <url>` ([remote mode](M1-CLI.md#remote-mode)); hooks exit with
  code 1 too, so the agent keeps working but Claude Code shows `UserPromptSubmit hook failed`
  and `Stop hook failed`; once the server is back, subscriptions reconnect on their own within
  the stream's `retry` (2 s) ([ADR 0006](../.yoke/adr/0006-many-sessions-per-scope.md#stand-facts)).
- `send` from another device answers `delivered: false` although the recipient's subscription
  delivers the message a fraction of a second later
  ([ADR 0006](../.yoke/adr/0006-many-sessions-per-scope.md#stand-facts)).

### Move to the server

Moving a personal database is the user's step, taken only on separate permission; an agent
never moves it on its own.

1. On the device: `home` and worktrees are clean and pushed, agents are stopped, and the
   device's engine has the server's version.
2. Snapshot both databases into a new private directory:

   ```sh
   S="${XDG_STATE_HOME:-$HOME/.local/state}/mypi"
   mkdir -m 700 <dir>
   sqlite3 "$S/state.sqlite3" ".backup <dir>/state.sqlite3"
   sqlite3 "$S/archive.sqlite3" ".backup <dir>/archive.sqlite3"
   ```

   `archive.sqlite3` exists only after the first `archive import` or capture; without the
   file, skip the last line.
3. Copy `<dir>` to the server over a private channel (any way, for example `scp`) and lay it
   out into a server state directory that does not exist yet, with the checks `restore`
   makes:

   ```sh
   S="${XDG_STATE_HOME:-$HOME/.local/state}/mypi"
   mkdir -p -m 700 "$S"
   cp <dir>/*.sqlite3 "$S/" && chmod 600 "$S"/*.sqlite3
   for f in "$S"/*.sqlite3; do
     sqlite3 "$f" 'PRAGMA integrity_check;' 'PRAGMA foreign_key_check;' 'PRAGMA user_version;'
   done
   mypi db init
   ```

   Each database prints `ok`, nothing, then `17` for `state.sqlite3` and `1` for
   `archive.sqlite3`; `mypi db init` changes nothing on the same schema.
4. On the server: a `device` token per device and the unit ([Server](#server)).
5. On the device: `server.json` ([Devices](#devices)), then move the old state directory
   aside instead of deleting it:

   ```sh
   S="${XDG_STATE_HOME:-$HOME/.local/state}/mypi"
   mv "$S" "$S.before-server"
   mypi task list
   ```

   Without moving it aside, an accidental removal of `server.json` would silently return the
   device to its stale local database; without the directory and without `server.json` a
   command refuses (`Cannot open database because the directory does not exist`), with no
   automatic initialization. `mypi task list` shows the server's tasks.

### Roll back

- Before the first write on the server, on the device:

  ```sh
  S="${XDG_STATE_HOME:-$HOME/.local/state}/mypi"
  rm "${XDG_CONFIG_HOME:-$HOME/.config}/mypi/server.json"
  mv "$S.before-server" "$S"
  ```

- After writes on the server: stop `serve` (`systemctl --user stop mypi-api`), take a
  `.backup` of both databases on the server into a new private directory (the commands of step
  2 of [Move to the server](#move-to-the-server)), copy it to the device and lay it out into
  the device's missing state directory with the same checks (the block of step 3 without
  `mypi db init`), then remove `server.json`:

  ```sh
  rm "${XDG_CONFIG_HOME:-$HOME/.config}/mypi/server.json"
  mypi task list
  ```

  The moved-aside `mypi.before-server` stays untouched. Roll the engine back to a version
  without `device` tokens only after revoking them ([Tokens](#tokens)).

### Backup timer (example)

Not installed automatically. `~/.config/systemd/user/mypi-backup.service`:

```ini
[Unit]
Description=mypi database snapshot

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'd=<backup-dir>/$(date +%%F); mkdir -p -m 700 "$d" && sqlite3 <state-dir>/state.sqlite3 ".backup $d/state.sqlite3" && sqlite3 <state-dir>/archive.sqlite3 ".backup $d/archive.sqlite3"'
```

`~/.config/systemd/user/mypi-backup.timer`:

```ini
[Unit]
Description=Daily mypi database snapshot

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl --user enable --now mypi-backup.timer
```

`.backup` is safe while `serve` runs; `%%` escapes `%` in systemd units; the timer never
removes old snapshots.

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
