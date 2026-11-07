# mypi

A project-centered knowledge and task system for explicit user-directed work.
[Workspace and development guidance](AGENTS.md) · [Workflow withdrawal](docs/AGENT-WORKFLOW.md) ·
[Roadmap](PLAN.md) · [Architecture](docs/ARCHITECTURE.md).

**Implemented:** a home knowledge tree (one `INDEX.md` entry per level), organizations/projects, DB task cards/statuses,
scoped journal, context Git, backup/restore, CLI and 14 stdio MCP agent tools over one API, an optional HTTP API (`mypi serve`, [docs/HTTP-API.md](docs/HTTP-API.md)) with a remote MCP subset at /mcp (maintenance is CLI-only, including undoing a mistaken project or organization registration).
`mypi warmup` prints a session's scoped context as Markdown; Claude Code (the tracked `.mcp.json` and `.claude/settings.json` hooks) and Pi (the tracked `.pi/extensions/mypi.ts`) load it into every session started in the checkout. Sessions are scoped to `global`, an organization, a project or a task (`MYPI_SCOPE`), registered in `sessions` and opened in Herdr tabs with `/open`; task chats report turn ends and waits as events (`/inbox`) to the parent chat, project or organization, whose message started the turn. No task registration, automatic logging or separate Herdr tab is required.
The former instruction-driven workflow has been withdrawn; stored data is retained.

**Future:** units, project flows and runtime enforcement.
Flow is part of the product direction; automated execution/visibility isolation are
not implemented. See [PLAN](PLAN.md) for milestones without speculative infrastructure.

**Readiness:** v0.11.0 is a prerelease of the v2 session model (scoped Claude Code
and Pi sessions, `/open`, events); it is not production-ready, and final M1 acceptance
remains open. CI now runs ordinary bounded PR verification, not the historical
trusted-base/App-issuer scheme. The earlier
[v0.1.0-rc.1](https://github.com/yokeloop/mypi/releases/tag/v0.1.0-rc.1) was a
release candidate. [Release snapshot](docs/RELEASE.md) and [file-map snapshot](docs/FILEMAP.md)
describe older revisions, not the current operating policy.

## Working model

- **State in SQLite; knowledge in files.** DB owns cards/statuses/relationships;
  Markdown does not duplicate live status. DB needs its own backup.
- **Task records are explicit data operations.** A card or saved capture does not
  launch work, create a session or authorize execution.
- **Project context is a directory.** The level's entry `INDEX.md`, glossary, notes, decisions and task
  materials live under home/projects/<org>/<project>, separate from the source checkout.
- **History records outcomes.** One factual outcome with evidence paths, not a narration
  of activity. Task history is an ordered append-only SQLite journal.
- **Artifacts are references into home history.** A journal artifact is `{path, commit}`:
  its file and a task's `source.md` can be edited, and the entry still reads the version
  it registered. Plain-path artifacts recorded before schema 11 stay frozen by their
  fingerprint. The inbox and append-only logs cannot change.
- **Saving is not synchronization.** `task progress` with artifacts commits the named
  files to home without pushing; other task and journal saves stay in SQLite without
  Git. Other context writes still commit locally. Commit remaining files before local
  backup; manual publication requires explicit authorization.
- **Future acceptance belongs to unit contracts.** A unit defines role, interface,
  restrictions and acceptance; it is not a running agent or a Pi extension. No
  universal human-only rule, and no acceptance that grants new external permissions.

## First-time setup

Start an agent from the mypi checkout to work across all your projects. The engine
and personal data share a workspace, **not a Git repository**. Agent configuration
is tracked engine source (`.pi/` for Pi); your instructions, settings and knowledge
live in an independent `home/` Git.

Requirements: the pinned Node 24/pnpm environment, Git, a terminal, and for Pi
version 1.0.4 (manually checked). Linux is the currently verified platform. No
global agent configuration is installed or changed.
Rust for the optional terminal UI is pinned in mise.toml and installed by mise install (rustup).

```bash
git clone https://github.com/yokeloop/mypi.git
cd mypi
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm bootstrap
mise exec -- pi
```

`pnpm bootstrap` builds the engine, then runs an **Ink terminal wizard**. Review its
plan and press `y` to apply; Enter, `n`, Escape or Ctrl+C cancels before any write.
Non-interactive input is refused. The wizard:

- Creates a missing `home/` with a separate Git on `main` (existing home Git
  configuration is kept), `home/USER-INSTRUCTIONS.md`, and `home/settings.json`
  with `{"defaultAgent": "claude"}`. Existing files are kept byte for byte.
- Shows the SQLite path and initializes the schema when the database file is absent.
  Uses `$XDG_STATE_HOME/mypi/state.sqlite3`, falling back to
  `~/.local/state/mypi/state.sqlite3`, the same as CLI/MCP. An existing database is
  left unchanged: no reset or implicit migration. A file created after the preview
  causes a refusal rather than an overwrite.
- Does **not** touch agent settings (`.pi/`, `~/.pi/agent/`), register projects,
  create remote repositories, commit/push personal files or migrate existing data.

A rerun with an existing home and database is a no-op. Stop other setup/storage
writers; changed previews are rejected. Errors report partial progress without
claiming a rollback. Review and commit new files in `home/`, and configure its
private remote and synchronization yourself; engine Git must never contain
personal data.

After successful first-time setup the database is initialized; no second bootstrap
command is needed. The existing CLI storage `bootstrap` remains available for
explicit administrative initialization/migration, without the setup wizard.

### Existing installations

Reuse an existing ordinary `home/` directory; the wizard preserves personal
instructions and knowledge and only adds missing files. Symlinked home roots are not
supported by the current storage guards. Earlier versions kept personal Pi
configuration in `home/pi/` behind a local `.pi -> home/pi` link; the tracked `.pi/`
directory replaces that link and `home/pi/` is no longer loaded. Before updating,
move the Pi settings, MCP servers, packages and resources you still need from
`home/pi/` to `~/.pi/agent/`, and remove an `integrations/pi` package entry from
`~/.pi/agent/settings.json` if you added one. Personal instructions need no link
any more: warmup serves `home/USER-INSTRUCTIONS.md`. Backups keep accepting the old
`home/pi/APPEND_SYSTEM.md` link.

### Where to customize

| Change | User-owned location |
|---|---|
| Personal agent instructions | `home/USER-INSTRUCTIONS.md` |
| Personal mypi settings (`defaultAgent`) | `home/settings.json` |
| Pi settings, MCP servers, packages, skills, extensions, prompts, themes | `~/.pi/agent/` |
| Project knowledge | `home/projects/<org>/<project>/` |
| Project source code | `projects/<org>/<project>/`, its own Git |
| Task worktrees | `projects/<org>/<project>--<KEY>-<slug>/`, created by `mypi task worktree <KEY>` |

`defaultAgent` names the agent (`claude` or `pi`) for new sessions that `/open`
starts; without the file or field it is `claude`. For baseline versus personal instruction ownership, see
[AGENTS.md](AGENTS.md#instruction-ownership).

`home/` and `projects/` are permanently reserved user paths, ignored by engine Git.
`.pi/` and `integrations/` are engine source: do not customize them unless
contributing to the engine. Use distinct names for personal resources.

### Pi

After project trust, Pi started in the checkout loads the tracked
`.pi/extensions/mypi.ts` and the built-in skills through `.pi/skills`, which points
to `integrations/skills/`. The extension needs a built engine. At each session start
(startup, `/new`, resume, fork, reload) it registers the `mypi` MCP server —
`node dist/src/mcp/main.js` from the checkout, with the session id in
`PI_SESSION_ID` — and runs `mypi warmup`; it first registers the session
(`mypi session register --agent pi`) and passes the registered key to the warmup,
and unregisters the process when Pi quits. The output becomes the `mypi_context`
system-prompt section of every turn of that session. Every turn it also adds a
codemode guideline that `searchTools()`, `describeTool()` and `describeNamespace()`
return Promises to be awaited. The key is the one saved for
this conversation, else `MYPI_SCOPE` of the Pi process, else `global`. If warmup fails, the section states the error, Pi shows
a warning and the MCP tools stay available. Tool schemas use the configured exposure
(mostly codemode; `projects` and `warmup` are direct).

Start Pi through `mise exec -- pi` so `node` on PATH is Node 24; Pi itself may be a
standalone executable rather than Node. `pi -ne` starts without extensions. A
file-configured server with the same name overrides the registration. Use isolated
state environment when selecting a test installation. For example, this user
configuration in `~/.pi/agent/mcp.json` disables the built-in server:

```json
{
  "mcpServers": {
    "mypi": { "command": "node", "enabled": false }
  }
}
```

Pi's `/mcp` manages session connections. Shell `pi mcp list` sees file-configured
servers only; it does not load the extension that registers mypi. Session changes
to an extension-registered server are not persistent; store overrides in `mcp.json`.
Keep credentials in environment variables or credential storage, not committed
settings. Use `/reload` or restart after changing the extension or rebuilding.

### Sessions

Both agents register their sessions: a row in the `sessions` table (key → agent
and native id, kept for continuation) and a live record in
`$XDG_RUNTIME_DIR/mypi/sessions/<key>.json` (owner-only; pid and process start,
native id, name, socket, start permission mode). The key is resolved in one
order: the row for this native id, the live record of the same process,
`MYPI_SCOPE`, `global`. A newer live session under a key becomes canonical and
the older record moves to `<key>~<pid>.json`. A fork started by hand without
`MYPI_SCOPE` is not registered. `mypi sessions` (MCP `sessions`) shows the tree
global → org → project → task; `mypi session forget <key>` drops a row on the
user's request. Without `XDG_RUNTIME_DIR` or an initialized schema 15 database
registration fails and the warmup still runs.

`/open <key...>` (the Claude skill `/open`, the Pi command `/open`, CLI
`mypi open`) needs a running Herdr server. In Pi, typing the arguments of /open
suggests keys: the session's project and its open tasks in a project or task chat,
the organization's projects and their open tasks in an organization chat, all
projects and open tasks in the main chat; choosing one inserts the key and a
space. For each key — an organization slug (`tb-ff`), a project code, CODE-N,
org/project or org/project#N — it focuses the live session's Herdr tab or opens a
new tab in its project's Herdr workspace (label `org/project`, created when
missing; a task gets its tab there without starting the project session; an
organization gets the tab `org-<slug>` in the workspace `<slug>`, with no clone or
worktree) in the engine root with `MYPI_SCOPE` and starts the agent there; an existing session
continues with its own agent. A project without a clone is first cloned from its
registered `repository` (`local`: `git init`) into `projects/<org>/<project>`,
verified and registered, with `clone prepared: …` in `notes`; git clones into a temporary sibling directory with live progress (the Pi footer
status, MCP progress notifications, CLI stderr lines prefixed "mypi: "), without a
total time limit but stopped after 5 minutes without progress, and the result
appears under projects/<org>/<project> only complete; Esc in Pi, cancelling the
MCP call or SIGINT/SIGTERM of the CLI stops git, removes the partial clone and
registers nothing, so the next /open prepares it again; without a
`repository` it is refused before anything opens. `global`, `all`, an unknown
organization and an organization without registered projects are refused. A new session (not a resumed or focused one) gets
one start message in the frame `[mypi: стартовое сообщение для <key>. …]` through
the same socket as events: for an organization the open tasks of each of its
projects by status and the number of its undelivered events, for a project its
open tasks by status and the number of undelivered events, for a task its status, worktree and the last journal
entries with their artifacts. It is state, not an instruction, and creates no
events. If it cannot be delivered, `/open` still succeeds and the key's `notes`
say `start message not delivered: <reason>`; for Claude in `bypassPermissions`
delivery is not promised, as for events. `/open <key> --message <text>` (one key;
the calling session must be the key's parent) also gives the session a parent
instruction: queued after the focus or start, sent live to a focused session,
after a resume, or in the same message as the start text; `opened[].message` is
its id.

A task chat (`MP-12`) reports to a parent key, its project (`MP`) or its
organization (`one`), through rows in the `events` table, only when the parent
needs to act on them. `turn_end` and `waiting` go to the sender of the message that
started the turn when it is a parent of the task, else to the project:

- `turn_end`: a turn that a parent message started ends. Claude's Stop hook runs
  `mypi turn end`; it records the event only when the transcript entry that opened
  the turn has `turnOrigin` `peer` and carries the mypi parent-message frame
  (`[mypi: сообщение родительской сессии MP для MP-12. …`). The Pi extension runs
  `mypi event emit --to <sender>` on `agent_settled` with the last reply only when a
  message with that frame started the turn through its socket. A turn a person started records
  nothing; an unreadable transcript or a missing mark records nothing.
- `waiting`: in such a parent-started turn, Claude's Notification hook for
  `permission_prompt` and `elicitation_dialog` (`mypi event emit --waiting --hook`)
  or Pi's `ui_prompt_start`. `idle_prompt` never creates an event.
- `milestone`: a task's status changes to `review`, `blocked`, `merged` or a terminal
  status; one event for the parent that last sent the task a message, else the
  project chat, unless that recipient itself makes the change (`task_update`,
  `mypi task status`).

A parent writes the parent-message frame itself: send_message (MCP), `mypi send
<key> (text | --file source)` or `/open <key> --message <text>` store an `events`
row of kind `message` from the parent to its direct child (project chat → its
task, organization chat → a task of its organization, main chat → a project or an
organization; any other caller is refused). A live child gets it
at once through the same socket as events, as a new turn; a closed child gets its
queued messages exactly once at the next `/open`, in one message with the start
text. The warmup shows no parent message as a message, at most its `message_sent`
journal fact line, and marks none of them; the child's own `/inbox` returns and marks
them, `/inbox all` skips them. The turn such a message opens is parent-started,
so its end comes back to the parent as `turn_end`. A busy Claude child takes the
message as a `queued_command` inside its current turn without a `turn_end` of its
own; Pi takes it as a `followUp` after the run. An instruction never carries the
engineer's authorization: steps such as /do, /ship, merge, release, migration or
an engine update still need the engineer's word in the child's tab.
Organization, project and global chats emit nothing. A parent chat receives the undelivered
events through `/inbox` (the Claude skill `/inbox`; the Pi command `/inbox`, which
runs the `inbox` skill as `/skill:inbox`; MCP `inbox`, CLI `mypi inbox`) and in its warmup under
«Новые события», even if it was closed when they arose; shown events are marked
delivered. Milestones arrive only there, never live. The project and organization warmups also list
«Последние доклады»: the last delivered `turn_end` of each open task, as history.
Delivery is at-least-once; the event number in the frame tells a repeat.

A live Pi project chat receives events at once. From `session_start` to
`session_shutdown` the Pi extension holds `$XDG_RUNTIME_DIR/mypi/<key>-<pid>.sock`
(0600) and records its path in the session's registration. Each Pi process has its
own socket, so a displaced session that quits never removes the socket of the
session that replaced it. After `mypi event emit`
records an event it sends all undelivered events of the parent except milestones, in id order, to the
parent's live Pi session and marks those the session acknowledges delivered: an idle
chat gets them as a new turn, a busy one after its current turn ends. Without a
socket or an answer the events wait for `/inbox` and the warmup. A displaced session
silently stops receiving events. An event injected while Pi is compacting or has no
model can be lost after it was acknowledged.

A live Claude project chat receives events at once too, through Claude's native
inbox socket (`CLAUDE_CODE_MESSAGING_SOCKET`, whose path the SessionStart hook
records). Each event goes out as one line `{"type":"user","message":{"role":"user",
"content":…}}`; the events count as delivered once the socket took the write, that
is, the server closed its side within 2 s. A refused or missing socket leaves them
for the next send, `/inbox` and the warmup. A parent in `bypassPermissions` gets
them live only when started with `crossSessionInbound` set to `accept`, as `/open`
does; until measured on a test installation this is not promised. Delivery stays
at-least-once: a missed server close sends the events again (the event number
tells the repeat); an event over 1 MiB never passes the socket and is sent again
with every send, so it stays in `/inbox` and the warmup; a message held in bypass
and then rejected or expired, or a parent that quits before handling it, is lost
after it was marked delivered.

Upgrading to schema 10: run `mypi db init` once after updating; until then every
command that opens the database, including warmup, asks for it.

Upgrading to schema 12: run `mypi db init` once after updating (back up the
database first).

Upgrading to schema 13: run `mypi db init` once after updating (back up the
database first).

Upgrading to schema 14: run `mypi db init` once after updating (back up the
database first); it rebuilds `sessions` for organization sessions and keeps its rows.

Upgrading to schema 15: run `mypi db init` once after updating (back up the
database first); it rebuilds `knowledge_journal` for the new event types and keeps
its rows.

### Updating without overwriting customizations

The installed engine is not a development checkout; contribute through the
[common project workflow](AGENTS.md#common-project-workflow). Once changes have
been merged, update a clean installation on `main` with `git pull --ff-only`
(to stop at a release, `git pull --ff-only origin v<version>`), install the locked dependencies (`mise install`, `mise exec -- pnpm install --frozen-lockfile`, `mise exec -- pnpm tui:fetch`), build (`mise exec -- pnpm build`, `mise exec -- pnpm tui:build`), then reload/restart Pi and reopen TUI tabs.
Updates replace built-in resources only; they never regenerate personal settings or
rerun bootstrap. Data-format migrations require a separate explicit operation. The
first update to a version with the tracked `.pi/` directory needs the move described
in [Existing installations](#existing-installations) first. Compatibility with
future Pi APIs still needs verification; separating paths prevents Git conflicts,
not API changes.

Back up both separate home Git and SQLite. Local `backup <directory>` requires clean
committed context. Manual `backup --publish [--dry-run] [--file exact-path ...]`
publishes an exact SQLite/home snapshot to existing home origin/main. Preview reports
excluded files and unpushed ancestor commits; review selected and committed text for
secrets. Generated `.mypi-backup/` is versioned while live DB remains outside home.
Restore a published commit using `restore --repository /local/clone --commit FULL_SHA`
only into absent installation targets. Inspect remote after uncertain publication
before retry; binary snapshots grow Git history. This does not recover external
clones, credentials, chats or unsaved data. Supported instruction symlink survives;
arbitrary symlinks are rejected. See [M1-CLI](docs/M1-CLI.md).

This organization supports one Pi workspace for multiple projects; it does not yet
implement a parallel task runner or protection against concurrent code edits.

## Claude Code

After `mise exec -- pnpm build`, run `claude` in the engine root. The tracked
`.mcp.json` registers the `mypi` MCP server (`node dist/src/mcp/main.js`, Node from
PATH); Claude asks once to approve it. `.claude/settings.json` allows the mypi tools
without prompts and adds one SessionStart command for every source (startup, resume,
clear, compact, fork): `mypi session register --agent claude --hook` (its output is
discarded, its failure does not stop the warmup), then `mypi warmup --max-chars 9500`:
the key saved for this conversation, else `MYPI_SCOPE`, else `global`. The Stop hook
runs `mypi turn end` and the Notification hook, for `permission_prompt` and
`elicitation_dialog`, runs `mypi event emit --waiting --hook`; both create an event
only in a turn a parent message started, discard their output and never block the
session. A forked
session gets the warmup of `MYPI_SCOPE`, else `global`, and is registered only with
`MYPI_SCOPE`. A failing warmup (for example an unknown
`MYPI_SCOPE`) shows its error to the user and the session starts without it. Shared
skills are symlinked from `integrations/skills/` into `.claude/skills/`. Keep
personal settings in `.claude/settings.local.json` (ignored) or user settings.

### Tabs opened by /open

`/open` starts Claude through `herdr agent start` with only `--session-id`/`--name`
(a new session) or `--resume <id>`, plus `--permission-mode` and
`--settings '{"crossSessionInbound":"accept"}'`, and passes the tab only
`MYPI_SCOPE` (and `XDG_STATE_HOME`). Everything else comes from the Herdr server's
environment and your user configuration: user settings, user hooks and user MCP
servers load in these tabs too.

### Restoring sessions after a Herdr restart or reboot

With `resume_agents_on_restore = true` in the Herdr config, Herdr restores
workspaces, tabs and their working directories and resumes each agent by its
native session id (Claude `--resume <id>`, Pi by its session file). It does not
keep environment variables or the extra arguments `/open` passed:

- The scope survives. The session key is resolved from the `sessions` row of the
  native id before `MYPI_SCOPE`, so a resumed project or task chat gets its own
  key, role and warmup without the variable. A brand-new conversation started by
  hand in a restored tab gets `global`.
- The permission mode does not survive: a resumed Claude session starts in the
  default mode of your settings.
- Live delivery of events and parent messages to a restored Claude session needs
  `"crossSessionInbound": "accept"` in your user settings (`~/.claude/settings.json`);
  without it they wait for `/inbox` and the warmup. It cannot go into the tracked
  project settings, which can only tighten cross-session delivery. Pi needs
  nothing extra.
- Live records under `$XDG_RUNTIME_DIR/mypi/sessions/` do not survive a reboot
  (a tmpfs); the resumed sessions register again at start.

### After updating the engine

The SessionStart, Stop and Notification hooks call the CLI from `dist/` on every
run, so they use the new build at once. The `mypi` MCP server of a running
session keeps the old code until it is restarted: in Claude use `/mcp` → `mypi` →
Reconnect (or restart the session); the new warmup text arrives at the next
`/clear`, `/compact` or restart. In Pi use `/reload` or restart the session.

## HTTP API

`mypi serve` runs an optional REST/JSON API over the same commands, in the foreground.
Create a token first with `mypi token create <name> --permission read|write`; it is
printed once and stored hashed in `$XDG_CONFIG_HOME/mypi/api-tokens.json`. Then start
`mypi serve`: it listens on `127.0.0.1:8737`, and `--listen <IP>` (for example a
Tailscale IP) is the only way to expose it. Routes, tokens, change streams and an
example systemd user unit: [docs/HTTP-API.md](docs/HTTP-API.md).
`mypi serve` also answers MCP at `/mcp` for agents on other machines (a read or write subset by token; [docs/MCP.md](docs/MCP.md#remote-mcp-over-http)).

Web UI: open `http://127.0.0.1:8737/` (or the `--listen` address) in a browser and
paste a token. The interface only reads: projects, tasks, events and the journal,
refreshed live. It is built into `dist/ui` by `pnpm build`; details in
[docs/HTTP-API.md](docs/HTTP-API.md#web-ui).

## Terminal UI

`tui/bin/mypi-tui` browses the same data in a terminal (also over ssh from a phone)
or as a Herdr plugin tab, and opens session tabs with `mypi open` inside Herdr.
Build it with `mise exec -- pnpm tui:fetch` (network, once per checkout) and
`mise exec -- pnpm tui:build`. Put a read token from `mypi token create tui
--permission read` into `$XDG_CONFIG_HOME/mypi/tui-token` (0600) or `MYPI_API_TOKEN`,
then run `tui/bin/mypi-tui [--url http://HOST:PORT]`. As a Herdr plugin:
`herdr plugin link <engine>/tui` (your step; the engine never links it). Details:
[docs/TUI.md](docs/TUI.md).

## Develop and verify

For an explicitly requested clean test stand, acceptance checklist and real Claude
Code, Pi and MCP checks through Herdr, follow the
[manual acceptance guide](docs/MANUAL-ACCEPTANCE.md).

TypeScript strict, Node.js 24 LTS, ESM/tsc, pnpm, SQLite + better-sqlite3, SQL migrations
without ORM; node:test + node:assert/strict. Modular monolith with Ports & Adapters.
The web UI in web/ (a pnpm workspace package) uses React, Mantine and Vite with Feature-Sliced Design; pnpm build typechecks it and bundles it into dist/ui.
The terminal UI in tui/ is Rust (ratatui); pnpm verify runs its cargo fmt, clippy, test and build offline in a bounded sandbox (docs/TUI.md).
Versions are pinned in mise.toml, package.json and the lockfile.

Releases go through a release PR like any other change. In a task worktree the
release's task branch moves `## [Unreleased]` of `CHANGELOG.md` to
`## [<version>] - <date>` and sets the version in `package.json` and
`src/mcp/server.ts`; after review and green CI the PR is merged with a merge commit.
Then, from the updated clone:

```bash
git tag -a v<version> -m "mypi v<version>" <merge-commit>
git push origin v<version>
# wait for the main CI run on that commit to succeed
gh release create v<version> --verify-tag --prerelease --title "mypi v<version>" --notes-file <notes>
```

The notes are the CHANGELOG section of the version plus an Upgrade note. Tags are
never moved; there is no npm publish. `scripts/release.mjs` (`pnpm release`) commits
and tags directly on `main`; it predates the PR workflow and is not used.

From the engine project's task worktree (not the installed workspace):

```bash
timeout --kill-after=5s 295s mise install
timeout --kill-after=5s 295s mise exec -- pnpm install --frozen-lockfile
timeout --kill-after=5s 295s mise exec -- pnpm tui:fetch
mise exec -- pnpm build
mise exec -- pnpm verify
```

CI runs on `pull_request` and pushes to `main`, checks out the proposed revision,
installs its frozen lockfile, and runs `bash scripts/ci.sh`. Dependency and script
changes are normal PR changes: there is no comparison against a separate trusted
base and no App publisher or privileged `pull_request_target` execution. Credentials
are not persisted by checkout; job permissions are read-only. Build/test resource
limits and network/home isolation remain in place. This is ordinary CI, not a
candidate-independent security attestation.

Read [TESTING](docs/TESTING.md) before test changes. test runs fast only; verify runs
admission + fast + boundary. Linux user systemd, cgroup v2 and bubblewrap are required;
no unsafe fallback. Build changed source/tests first; stale dist is rejected. Tests
create disposable installations and must not use the personal DB/home.

CLI help: `mise exec -- node dist/src/cli/main.js --help`.
[CLI and recovery](docs/M1-CLI.md) · [MCP and project-local Pi setup](docs/MCP.md).
Reads do not initialize missing storage. Bootstrap/restore/registration require explicit
intent. Do not modify global Pi instructions/configuration for local instruction upkeep.

## Storage layout

```text
mypi/
├── src/                         # cli, mcp, app, modules, infrastructure, shared
├── test/                        # fast and boundary
├── scripts/                     # bounded build/checks
├── integrations/prompts/        # warmup role and how-to texts
├── integrations/skills/         # built-in skills: open, inbox, project-management
├── .pi/                         # tracked Pi configuration
│   ├── extensions/mypi.ts       # MCP registration and warmup per session
│   └── skills -> ../integrations/skills
├── .claude/                     # tracked Claude Code configuration
│   ├── settings.json            # mypi MCP allow list, SessionStart/Stop/Notification hooks
│   ├── skills/                  # links to integrations/skills/ and the pipeline skills
│   └── agents/                  # pipeline agents
├── .mcp.json                    # mypi MCP server for Claude Code
├── .yoke/                       # v2 glossary (context.md) and ADRs (adr/)
├── CHANGELOG.md
├── home/                        # separate ignored user/context Git
│   ├── USER-INSTRUCTIONS.md
│   ├── settings.json            # personal mypi settings (defaultAgent)
│   ├── INDEX.md
│   ├── inbox/*.md
│   ├── notes/*.md
│   ├── journal/YYYY-MM.jsonl
│   ├── tasks/REQ-number-slug/        # legacy standalone records
│   └── projects/<org>/
│       ├── INDEX.md
│       └── <project>/
│           ├── INDEX.md, context.md, errors.md
│           ├── notes/
│           └── tasks/CODE-number-slug/
└── projects/                    # ignored project code, not project knowledge
    └── <org>/
        ├── <project>/           # independent base clone
        └── <project>--<KEY>-<slug>/ # task worktree: mypi task worktree <KEY>

$XDG_STATE_HOME/mypi/state.sqlite3 # outside both Git repositories
```

A card's context_dir locates source.md and artifacts. `mypi task worktree <KEY>` creates the task branch and its worktree `<clone>--<KEY>-<slug>` beside the base clone by the project's flow (`home/projects/<org>/<project>/flow.json`, read with `mypi project flow`; without it `task/<KEY>-<slug>` from the fast-forwarded `origin/HEAD`, else `main`), records the path in the card and on repeat returns the recorded worktree; an invalid flow is refused. Its current status is in DB;
history is in the SQLite journal. Existing monthly UTC JSONL files remain unchanged;
explicit `mypi journal import` imports them once after old writers are stopped. New tasks always belong
to a registered project; existing standalone REQ records stay readable under their keys. Homes created
before v2 keep task folders under requests/ until mypi home migrate-tasks moves them.
`mypi warmup [-s global|org|CODE|CODE-N] [--max-chars n]` prints the starting context of a global, organization, project or task session (without -s it uses the session's registered key, else MYPI_SCOPE, else global); over 64 KiB (or over n characters with --max-chars, as the Claude Code hook uses) it clips the farthest knowledge entry first and names the `context_read` call (and CLI `context read`) that reads it in full; headings of the embedded files are demoted below the warmup's own sections ([ARCHITECTURE §5](docs/ARCHITECTURE.md)). Global
journal means global entries only; reading all history is explicit.

The old prototype, import and format compatibility were removed by user request.
M1 SQL schema migrations and backup/restore remain. Historical evidence is not
permission to restore the old model.

## Documents

- [AGENTS](AGENTS.md): development guidance; [AGENT-WORKFLOW](docs/AGENT-WORKFLOW.md): withdrawal of the former mandatory workflow.
- [PLAN](PLAN.md), [ARCHITECTURE](docs/ARCHITECTURE.md): direction and actual capabilities.
- [M1-DESIGN](docs/M1-DESIGN.md): accepted stack, module/dependency design and decision history.
- [M1-REQUESTS](docs/M1-REQUESTS.md), [M1-START](docs/M1-START.md): accepted storage contracts of the request era;
  historical accounting guidance does not impose an agent workflow.
- [TESTING](docs/TESTING.md): sole test-policy source, budgets, review and isolation.
- [CHANGELOG](CHANGELOG.md): released versions and unreleased changes.
- [MANUAL-ACCEPTANCE](docs/MANUAL-ACCEPTANCE.md): live acceptance with Claude Code, Pi and Herdr on a disposable stand.
- [PIPELINE](docs/PIPELINE.md), [PLAN-FORMAT](docs/PLAN-FORMAT.md): the /plan, /do, /flow, /ship and /board pipeline and the shape of its plans.
- [v2 facts](docs/v2/facts.md), [ADRs](.yoke/adr/): stage-0 measurements and decisions of the v2 session model.
- [M1-CLI](docs/M1-CLI.md), [MCP](docs/MCP.md): active operation guides.
- [M0-CONTRACT](docs/M0-CONTRACT.md): historical agreements, not perpetual permissions.
- [M1-CYCLE](docs/M1-CYCLE.md), [MCP-CYCLE](docs/MCP-CYCLE.md): versioned verification evidence.
- [Pi subagents reference](references/pi-subagents-reference.md),
  [Pi extensions reference](references/pi-extensions-reference.md): background research,
  not evidence that a future runner is implemented or its guarantees verified.
