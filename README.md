# mypi

A project-centered memory and task system for explicit user-directed work.
[Workspace and development guidance](AGENTS.md) · [Workflow withdrawal](docs/AGENT-WORKFLOW.md) ·
[Roadmap](PLAN.md) · [Architecture](docs/ARCHITECTURE.md).

**Implemented:** local memory, organizations/projects, DB task cards/statuses,
scoped journal, context Git, backup/restore, CLI and 12 stdio MCP agent tools over one API (maintenance is CLI-only).
`mypi warmup` prints a session's scoped context as Markdown; the tracked Pi extension loads it into every Pi session started in the checkout; no task registration, automatic logging or separate Herdr tab is required.
The former instruction-driven workflow has been withdrawn; stored data is retained.

**Future:** units, project flows, runtime enforcement and agents with different scopes.
Flow is part of the product direction; automated execution/visibility isolation are
not implemented. See [PLAN](PLAN.md) for milestones without speculative infrastructure.

**Readiness:** the stdio MCP server and withdrawal of the mandatory agent workflow
are included since v0.1.1. This project is not production-ready: final M1 acceptance
remains open. CI now runs ordinary bounded PR verification, not the historical
trusted-base/App-issuer scheme. The earlier
[v0.1.0-rc.1](https://github.com/yokeloop/mypi/releases/tag/v0.1.0-rc.1) was a
release candidate. [Release snapshot](docs/RELEASE.md), [file-map snapshot](docs/FILEMAP.md)
and [published RC report](https://draft.yokeloop.com/artifacts/mypi-m1-bqso2mhf)
describe older revisions, not the current operating policy.

## Working model

- **State in SQLite; knowledge in files.** DB owns cards/statuses/relationships;
  Markdown does not duplicate live status. DB needs its own backup.
- **Task records are explicit data operations.** A card or saved capture does not
  launch work, create a session or authorize execution.
- **Project context is a directory.** MEMORY, glossary, notes, decisions and task
  materials live under home/projects/<org>/<project>, separate from the source checkout.
- **History records outcomes.** One factual outcome with evidence paths, not a narration
  of activity. Task history is an ordered append-only SQLite journal.
- **Published artifacts remain addressable.** New versions use new paths. Mutable
  memory/context can change with history; original source and append-only logs cannot.
- **Saving is not synchronization.** Task and journal operations save locally in
  SQLite without Git. Other context writes still commit locally. Publish source and
  artifact files separately before local backup; manual publication requires explicit authorization.
- **Future acceptance belongs to unit contracts.** A unit defines role, interface,
  restrictions and acceptance; it is not a running agent or a Pi extension. No
  universal human-only rule, and no acceptance that grants new external permissions.

## First-time setup

Start an agent from the mypi checkout to work across all your projects. The engine
and personal data share a workspace, **not a Git repository**. Agent configuration
is tracked engine source (`.pi/` for Pi); your instructions, settings and memory
live in an independent `home/` Git.

Requirements: the pinned Node 24/pnpm environment, Git, a terminal, and for Pi
version 1.0.4 (manually checked). Linux is the currently verified platform. No
global agent configuration is installed or changed.

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
instructions and memory and only adds missing files. Symlinked home roots are not
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
system-prompt section of every turn of that session. The key is the one saved for
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
`MYPI_SCOPE` is not registered. `mypi sessions` (MCP `sessions`) shows the tree;
`mypi session forget <key>` drops a row on the user's request. Without
`XDG_RUNTIME_DIR` or an initialized schema 9 database registration fails and the
warmup still runs.

`/open <key...>` (the Claude skill `/open`, the Pi command `/open`, CLI
`mypi open`) needs a running Herdr server. For each key — a project code, CODE-N,
org/project or org/project#N — it focuses the live session's Herdr tab or opens a
new tab in the engine root with `MYPI_SCOPE` and starts the agent there; an
existing session continues with its own agent.

A task chat (`MP-12`) reports to its parent key (`MP`) through rows in the `events`
table, only when the parent needs to act on them:

- `turn_end`: a turn that a parent message started ends. Claude's Stop hook runs
  `mypi turn end`; it records the event only when the transcript entry that opened
  the turn has `turnOrigin` `peer` and carries the mypi parent-message frame
  (`[mypi: сообщение родительской сессии MP для MP-12. …`). The Pi extension runs
  `mypi event emit` on `agent_settled` with the last reply only when a message with
  that frame started the turn through its socket. A turn a person started records
  nothing; an unreadable transcript or a missing mark records nothing.
- `waiting`: in such a parent-started turn, Claude's Notification hook for
  `permission_prompt` and `elicitation_dialog` (`mypi event emit --waiting --hook`)
  or Pi's `ui_prompt_start`. `idle_prompt` never creates an event.
- `milestone`: a task's status changes to `review`, `blocked`, `merged` or a terminal
  status, unless the project chat itself makes the change (`task_update`,
  `mypi task status`).

Until the parent-to-child channel (MP-55) lands, nothing writes the parent-message
frame into a child's socket, so the Claude hooks and the Pi extension create no
events at all; only milestones and a manual `mypi event emit --from` remain.
Project and global chats emit nothing. The project chat receives the undelivered
events through `/inbox` (the Claude skill `/inbox`; the Pi command `/inbox`, which
runs the `inbox` skill as `/skill:inbox`; MCP `inbox`, CLI `mypi inbox`) and in its warmup under
«Новые события», even if it was closed when they arose; shown events are marked
delivered. Milestones arrive only there, never live. The project warmup also lists
«Последние доклады»: the last delivered `turn_end` of each open task, as history.
Delivery is at-least-once; the event number in the frame tells a repeat.

A live Pi project chat receives events at once. From `session_start` to
`session_shutdown` the Pi extension holds `$XDG_RUNTIME_DIR/mypi/<key>-<pid>.sock`
(0600) and records its path in the session's registration. Each Pi process has its
own socket, so a displaced session that quits never removes the socket of the
session that replaced it. After `mypi event emit`
records an event it sends all undelivered events of the parent, in id order, to the
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

Upgrading to schema 9: run `mypi db init` once after updating; until then every
command that opens the database, including warmup, asks for it.

### Updating without overwriting customizations

The installed engine is not a development checkout; contribute through the
[common project workflow](AGENTS.md#common-project-workflow). Once changes have
been merged, update a clean installation on its release branch with
`git pull --ff-only`, install the locked dependencies, build, then reload/restart Pi.
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

## Develop and verify

For an explicitly requested clean test stand, acceptance checklist and real Pi/MCP
checks through Herdr, follow the [manual acceptance guide](docs/MANUAL-ACCEPTANCE.md).

TypeScript strict, Node.js 24 LTS, ESM/tsc, pnpm, SQLite + better-sqlite3, SQL migrations
without ORM; node:test + node:assert/strict. Modular monolith with Ports & Adapters.
Versions are pinned in mise.toml, package.json and the lockfile.

To publish a new version from a clean `main` with GitHub CLI authenticated:

```bash
mise exec -- pnpm release 0.1.2 # replace with the next version
```

The command updates package/MCP versions, builds and verifies, commits and tags that
same commit, pushes both refs atomically, waits for hosted CI on that SHA and creates
a GitHub prerelease (no npm publish). Tags are never moved. After a partial remote
write, inspect the reported state and rerun the same command to continue; it does not
roll back published refs. This is release automation, not an independent trusted gate.

From the engine project's task worktree (not the installed workspace):

```bash
timeout --kill-after=5s 295s mise install
timeout --kill-after=5s 295s mise exec -- pnpm install --frozen-lockfile
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
├── home/                        # separate ignored user/context Git
│   ├── USER-INSTRUCTIONS.md
│   ├── settings.json            # personal mypi settings (defaultAgent)
│   ├── MEMORY.md
│   ├── inbox/*.md
│   ├── notes/*.md
│   ├── journal/YYYY-MM.jsonl
│   ├── tasks/REQ-number-slug/        # legacy standalone records
│   └── projects/<org>/
│       ├── MEMORY.md
│       └── <project>/
│           ├── MEMORY.md, context.md, errors.md
│           ├── notes/
│           └── tasks/CODE-number-slug/
└── projects/                    # ignored project code, not project knowledge
    └── <org>/
        ├── <project>/           # independent base clone
        └── <project>--<KEY>-<slug>/ # task worktree: mypi task worktree <KEY>

$XDG_STATE_HOME/mypi/state.sqlite3 # outside both Git repositories
```

A card's context_dir locates source.md and artifacts. `mypi task worktree <KEY>` creates the task branch `task/<KEY>-<slug>` and its worktree beside the base clone from the fast-forwarded main branch and records the path in the card. Its current status is in DB;
history is in the SQLite journal. Existing monthly UTC JSONL files remain unchanged;
explicit `mypi journal import` imports them once after old writers are stopped. New tasks always belong
to a registered project; existing standalone REQ records stay readable under their keys. Homes created
before v2 keep task folders under requests/ until mypi home migrate-tasks moves them.
`mypi warmup [-s global|CODE|CODE-N] [--max-chars n]` prints the starting context of a global, project or task session (without -s it uses the session's registered key, else MYPI_SCOPE, else global); over 64 KiB (or over n characters with --max-chars, as the Claude Code hook uses) it hides the oldest memory facts of the farthest zone first and names the `memory` show call (and CLI command) that reads them in full; headings of the embedded files are demoted below the warmup's own sections ([ARCHITECTURE §5](docs/ARCHITECTURE.md)). Global
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
- [M1-CLI](docs/M1-CLI.md), [MCP](docs/MCP.md): active operation guides.
- [M0-CONTRACT](docs/M0-CONTRACT.md): historical agreements, not perpetual permissions.
- [M1-CYCLE](docs/M1-CYCLE.md), [MCP-CYCLE](docs/MCP-CYCLE.md): versioned verification evidence.
- [Pi subagents reference](references/pi-subagents-reference.md),
  [Pi extensions reference](references/pi-extensions-reference.md): background research,
  not evidence that a future runner is implemented or its guarantees verified.
