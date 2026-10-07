# mypi

A project-centered memory and request system for explicit user-directed work.
[Workspace and development guidance](AGENTS.md) · [Workflow withdrawal](docs/AGENT-WORKFLOW.md) ·
[Roadmap](PLAN.md) · [Architecture](docs/ARCHITECTURE.md).

**Implemented:** local memory, organizations/projects, DB request cards/statuses,
scoped journal, context Git, backup/restore, CLI and 31 stdio MCP tools over one API.
These are optional tools, not a mandatory agent workflow. Connecting mypi does not
require task registration, memory warmup, automatic logging or a separate Herdr tab.
The former instruction-driven workflow has been withdrawn; stored data is retained.

**Future:** units, project flows, runtime enforcement and agents with different scopes.
Flow is part of the product direction; automated execution/visibility isolation are
not implemented. See [PLAN](PLAN.md) for milestones without speculative infrastructure.

**Readiness:** the stdio MCP server and withdrawal of the mandatory agent workflow
are included since v0.1.1. This project is not production-ready: the independent App
issuer/trusted gate and final M1 acceptance remain open ([M1-CI](docs/M1-CI.md)). The earlier
[v0.1.0-rc.1](https://github.com/yokeloop/mypi/releases/tag/v0.1.0-rc.1) was a
release candidate. [Release snapshot](docs/RELEASE.md), [file-map snapshot](docs/FILEMAP.md)
and [published RC report](https://draft.yokeloop.com/artifacts/mypi-m1-bqso2mhf)
describe older revisions, not the current operating policy.

## Working model

- **State in SQLite; knowledge in files.** DB owns cards/statuses/relationships;
  Markdown does not duplicate live status. DB needs its own backup.
- **Request records are explicit data operations.** A card or saved capture does not
  launch work, create a session or authorize execution.
- **Project context is a directory.** MEMORY, glossary, notes, decisions and request
  materials live under home/projects/<org>/<project>, separate from the source checkout.
- **History records outcomes.** One factual outcome with evidence paths, not a narration
  of activity. Request history comes from a shared append-only JSONL journal.
- **Published artifacts remain addressable.** New versions use new paths. Mutable
  memory/context can change with history; original source and append-only logs cannot.
- **Saving is not synchronization.** Context writes include local Git commits;
  DB-only changes use transactions. Network sync requires separate authorization.
- **Future acceptance belongs to unit contracts.** A unit defines role, interface,
  restrictions and acceptance; it is not a running agent or a Pi extension. No
  universal human-only rule, and no acceptance that grants new external permissions.

## First-time setup: the user layer

Start Pi from the mypi checkout to work across all your projects. The engine and
personal data share a workspace, **not a Git repository**. Built-in Pi resources
are a local package in `integrations/pi/`; your customizations and memory live in
an independent `home/` Git. `.pi` is an ignored symlink to `home/pi`.

Requirements: the pinned Node 24/pnpm environment, Git, a terminal, and Pi supporting
local packages and `registerMcpServer` (manually checked with Pi 1.0.0). Linux is the
currently verified platform. No global Pi configuration is installed or changed.

```bash
git clone https://github.com/yokeloop/mypi.git
cd mypi
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm bootstrap
mise exec -- pi
```

`pnpm bootstrap` builds the engine, then runs an **Ink terminal wizard**. Review its
plan and press `y` to apply; Enter, `n`, Escape or Ctrl+C cancels before user-layer
writes. Non-interactive input is refused. The wizard:

- Creates missing `home/`, a separate Git on `main` if none exists, user resource
  directories, instruction and MCP files. Existing home Git configuration is kept.
- Installs `.pi -> home/pi` and
  `home/pi/APPEND_SYSTEM.md -> ../USER-INSTRUCTIONS.md`.
- Adds the absolute local `integrations/pi` package path to `home/pi/settings.json`.
  It preserves unrelated settings and existing package filters. Before modifying
  existing settings, it saves their exact bytes as `settings.json.before-bootstrap`;
  an occupied backup path is a conflict, not permission to overwrite it.
- Does **not** initialize SQLite, register projects, create remote repositories,
  commit/push personal files, migrate memory or modify global Pi settings.

A configured rerun is a no-op. Close other configuration writers during setup;
changed previews are rejected. Errors report partial progress without claiming a
rollback. Review and commit new files in `home/`, and configure its private remote
and synchronization yourself; engine Git must never contain personal data.

**This is not the storage command named `bootstrap`.** When you explicitly want to
initialize the mypi database as well, run the following separately (stop other
storage writers first):

```bash
mise exec -- node dist/src/cli/main.js bootstrap
```

### Existing installations

Reuse an existing ordinary `home/` directory; the wizard preserves personal
instructions, memory and MCP configuration. Symlinked home roots are not supported
by the current storage guards. An empty old `.pi`, or one containing only the former
`APPEND_SYSTEM.md -> ../home/USER-INSTRUCTIONS.md` link, can be converted after
confirmation. Any other existing `.pi` directory or conflicting link is refused
before writes. Review and relocate its custom files into `home/pi/` yourself,
reconcile relative paths and the instruction link, then rerun. No automatic merge
or deletion of arbitrary user configuration is attempted.

### Where to customize

| Change | User-owned location |
|---|---|
| Personal agent instructions | `home/USER-INSTRUCTIONS.md` |
| Pi settings and package resource filters | `home/pi/settings.json` |
| Additional MCP servers / built-in server overrides | `home/pi/mcp.json` |
| Skills | `home/pi/skills/<name>/SKILL.md` |
| Extensions | `home/pi/extensions/` |
| Prompt templates and themes | `home/pi/prompts/`, `home/pi/themes/` |
| Project knowledge | `home/projects/<org>/<project>/` |
| Project source code | `projects/<checkout>/`, its own Git |

All of `.pi`, `home/` and `projects/` are permanently reserved user paths, ignored by
engine Git. Do not customize files under `integrations/pi/` unless contributing to
the engine. Package resources load directly from there without being copied into
home. Use distinct names for personal resources; to replace a built-in resource,
exclude it via Pi package filters and load your own implementation explicitly.

The shipped extension registers the built-in `mypi` MCP server using Node on PATH.
Start Pi through `mise exec -- pi`; Pi itself may be a standalone executable rather
than Node. A file-configured server with the same name overrides the registration.
For example, this user configuration disables the built-in server:

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
settings. Approve project trust to load the package and personal resources, and
use `/reload` or restart after changing them. A project `APPEND_SYSTEM.md` takes
precedence over the global file of that name; they are not concatenated.

### Updating without overwriting customizations

With a clean engine checkout on the release branch, update with a fast-forward pull,
install the locked dependencies, build, then reload/restart Pi. Updates replace
built-in resources only; they never regenerate user settings or rerun bootstrap.
Data-format migrations require a separate explicit operation. If the checkout
moves, review the absolute package path in user settings: bootstrap adds the current
path but does not silently remove other entries. Compatibility with future Pi APIs
still needs verification; separating paths prevents Git conflicts, not API changes.

Back up both the separate home Git and SQLite. The context backup command requires
a clean committed home (including configuration); it preserves the exact personal
instruction symlink but rejects arbitrary symlinks. MCP-managed content still cannot
be edited through links. Bootstrap leaves files for review, so commit them before
using context backup. Git alone does not back up SQLite.

This organization supports one Pi workspace for multiple projects; it does not yet
implement a parallel task runner or protection against concurrent code edits.

## Develop and verify

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

From the engine checkout:

```bash
timeout --kill-after=5s 295s mise install
timeout --kill-after=5s 295s mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- pnpm verify
```

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
├── integrations/pi/             # tracked built-in Pi package: extensions + skills
├── .pi -> home/pi               # ignored local link, installed by bootstrap
├── home/                        # separate ignored user/context Git
│   ├── USER-INSTRUCTIONS.md
│   ├── pi/                      # settings, MCP, personal resources
│   │   └── APPEND_SYSTEM.md -> ../USER-INSTRUCTIONS.md
│   ├── MEMORY.md
│   ├── inbox/*.md
│   ├── notes/*.md
│   ├── journal/YYYY-MM.jsonl
│   ├── requests/REQ-number-slug/
│   └── projects/<org>/
│       ├── MEMORY.md
│       └── <project>/
│           ├── MEMORY.md, context.md, errors.md
│           ├── notes/
│           └── requests/CODE-number-slug/
└── projects/                    # ignored working clones, not project knowledge

$XDG_STATE_HOME/mypi/state.sqlite3 # outside both Git repositories
```

A card's context_dir locates source.md and artifacts. Its current status is in DB;
history is in the common monthly UTC journal. Standalone REQ records remain supported
by the storage/API, independently of any agent workflow.
Scoped warmup inherits parent MEMORY, not global inbox or sibling context. Global
journal means global entries only; reading all history is explicit.

The old prototype, import and format compatibility were removed by user request.
M1 SQL schema migrations and backup/restore remain. Historical evidence is not
permission to restore the old model.

## Documents

- [AGENTS](AGENTS.md): development guidance; [AGENT-WORKFLOW](docs/AGENT-WORKFLOW.md): withdrawal of the former mandatory workflow.
- [PLAN](PLAN.md), [ARCHITECTURE](docs/ARCHITECTURE.md): direction and actual capabilities.
- [M1-DESIGN](docs/M1-DESIGN.md): accepted stack, module/dependency design and decision history.
- [M1-REQUESTS](docs/M1-REQUESTS.md), [M1-START](docs/M1-START.md): accepted storage contracts;
  historical accounting guidance does not impose an agent workflow.
- [TESTING](docs/TESTING.md): sole test-policy source, budgets, review and isolation.
- [M1-CLI](docs/M1-CLI.md), [MCP](docs/MCP.md): active operation guides.
- [M0-CONTRACT](docs/M0-CONTRACT.md): historical agreements, not perpetual permissions.
- [M1-CYCLE](docs/M1-CYCLE.md), [MCP-CYCLE](docs/MCP-CYCLE.md): versioned verification evidence.
- [Pi subagents reference](references/pi-subagents-reference.md),
  [Pi extensions reference](references/pi-extensions-reference.md): background research,
  not evidence that a future runner is implemented or its guarantees verified.
