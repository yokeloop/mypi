# mypi

A project-centered memory and request system for explicit user-directed work.
[Workspace and development guidance](AGENTS.md) · [Workflow withdrawal](docs/AGENT-WORKFLOW.md) ·
[Roadmap](PLAN.md) · [Architecture](docs/ARCHITECTURE.md).

**Implemented:** local memory, organizations/projects, DB request cards/statuses,
scoped journal, context Git, backup/restore, explicit Git workspace helpers,
coordinated home document writes, CLI and 49 stdio MCP tools over one API.
These are optional tools, not a mandatory agent workflow. Connecting mypi does not
require task registration, memory warmup, automatic logging or a separate Herdr tab.
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
- **Request records are explicit data operations.** A card or saved capture does not
  launch work, create a session or authorize execution.
- **Project context is a directory.** MEMORY, glossary, notes, decisions and request
  materials live under home/projects/<org>/<project>, separate from the source checkout.
- **History records outcomes.** One factual outcome with evidence paths, not a narration
  of activity. Request history comes from a shared append-only JSONL journal.
- **Published artifacts remain addressable.** New versions use new paths. Mutable
  memory/context can change with history; original source and append-only logs cannot.
- **Saving has explicit boundaries.** Participating managed home writes and ordinary
  document patches coordinate exact commits and one bounded publication attempt;
  they require configured, published home `main`. DB-only changes use transactions.
  Uncertain outcomes require inspection, not automatic replay. These capabilities
  do not grant authorization for unrequested writes or remote setup.
- **Future acceptance belongs to unit contracts.** A unit defines role, interface,
  restrictions and acceptance; it is not a running agent or a Pi extension. No
  universal human-only rule, and no acceptance that grants new external permissions.

## First-time setup: select an installation

Use the pinned Node 24/pnpm environment, Git and Pi with local packages and
`registerMcpServer` (native behavior is exercised against Pi 1.0.4). From the
engine checkout, build and run the one-time interactive setup:

```bash
git clone https://github.com/yokeloop/mypi.git
cd mypi
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm bootstrap
mise exec -- pi
```

The interactive wizard shows this checkout and its setup state, then offers
menus for a new independent home Git, an existing home Git or a Git clone. Use
↑/↓ and Enter to select; Esc goes back before effects, Ctrl+C cancels, and
visible Back/Cancel actions are available. The recommended new home is `./home`
in this checkout. Storage offers a new SQLite DB with a recommended runtime directory, an existing
DB, or separate path choices. The suggestions for a new checkout are
`<state-base>/mypi/installations/<checkout-name>-<path-hash>/state.sqlite3` and
`.../runtime`, where `<state-base>` is absolute `XDG_STATE_HOME` if set, otherwise
`~/.local/state`; the hash is the first eight SHA-256 hex digits of the canonical
checkout path. Invalid explicit `XDG_STATE_HOME` is shown as a problem: choose
paths manually, rather than silently falling back. Suggestions do not move an
existing installation or choose a personal DB.

Path menus offer a directory/file browser (parent, home and checkout shortcuts,
filter and paginated entries), a future child name, or manual entry. Relative
paths such as `home`, `./home` and `../shared-home` resolve from the displayed
canonical checkout, `~/...` from the user's home; the browser displays its own
current directory. Manual path fields support cursor editing, Home/End,
Backspace/Delete, paste and Tab completion (↑/↓ and Enter choose among multiple
matches). Empty Enter accepts a shown suggestion, not Back. In long-path views,
←/→ reveals hidden portions; inspect the full resolved paths and resource details
in the preview before applying.

Clone has its **own** safe-default confirmation to create only home; it does not
consent to DB creation or installation binding. After a successful clone, Back/Esc
cannot return to pre-clone home/source selection: DB/runtime choices and review
remain editable, while changing home requires ending this run and starting another.
Cancellation retains the clone. Confirm installation separately. At the final
confirmation, Enter initially selects Back, not Apply; explicitly select the
effect action. Editing allowed choices in the preview retains unrelated answers
and generates a new preview. Applying rechecks for changed inputs and refuses stale/conflicting choices. Cancel before effects
does not write setup data (the `pnpm bootstrap` build can still update `dist`).
After clone, cancellation retains that destination and origin; a stopped or
failed clone may leave a partial destination and must be inspected before another
attempt. After an attempted installation write, inspect the listed paths and
binding: there is no transactional rollback. The wizard never commits/pushes
home, migrates existing DB data, registers projects, launches Pi or changes global
Pi settings/authentication. Keep home Git and SQLite backed up independently;
configure a private remote explicitly.

The ignored `.mypi-local.json` binds `version: 1`, `engineRoot`, `homeRoot`,
`database` and `stateRoot` to this checkout. Missing, moved or invalid binding
requires setup/reconciliation, never a fallback to a personal XDG database.
`stateRoot/sessions` and `stateRoot/mailbox` are the default native runtime
locations; explicit `MYPI_SESSION_DIR` and `MYPI_MAILBOX_DIR` must agree with
this binding or startup refuses. `MYPI_INSTALLATION_FILE` is an absolute
binding selector for this same engine, not a cross-installation switch. The
ordinary Pi agent directory (auth/models, normally `~/.pi/agent`) remains
separate from the selected home; no credential files are copied.

Setup projects selected-home Pi resources into a **local ignored `.pi`
directory**, not a `.pi -> home/pi` symlink. Its `settings.json` is a reviewed
snapshot selecting this engine's `integrations/pi` package while retaining
unrelated local settings and resource filters. Documented resource paths are
rebased; existing shared-home settings are not rewritten. A known previous
engine package in user-level settings can be shadowed with empty resource
filters for that same source; unknown/ambiguous package conflicts, including
project-target sources outside the known preflight, require manual reconciliation. This is a limited known-engine preflight, not a proof
of Pi's complete package-resolution order. Setup may link local
`.pi/APPEND_SYSTEM.md` and `.pi/mcp.json` to reviewed selected-home resources.
A preexisting explicit project append or local MCP customization is retained
with a warning: Pi's project append **overrides**, rather than combines with,
its agent-directory append; file-configured MCP entries (including
`enabled:false`) override extension registrations. A legacy `.pi -> home/pi`
link is converted only through the preview, preserving its target bytes;
nonstandard `.pi` contents require reconciliation.

On rerun, a configured checkout shows its current paths and can report
"Already configured" without rewriting files. To refresh changed shared
resources, select the visible "Prepare updated preview" action, inspect the
revised changes and explicitly confirm; there is no hidden refresh key. Stale
previews and changed inputs refuse; conflicts require explicit reconciliation,
not deleting arbitrary `.pi` contents or silently adopting another binding.
Configuration links outside managed context do not allow arbitrary symlinks
in managed home documents or backup.

### Ordinary Pi, local CLI and project tabs

After setup and `mise exec -- pnpm build`, **`mise exec -- pi` from this
configured engine root** is the ordinary Pi entry: a fresh conversation starts
with mypi `unrestricted` context (no project filter, not elevated permissions).
No wrapper, global `mypi` installation, shell export or alternate Pi host is
needed. A saved native branch's project context remains authoritative on
resume/tree/fork. `/new` at the configured root starts fresh unrestricted,
ignoring an old startup handoff; `/new` inside a task cwd does not auto-escalate.
Explicit scoped handoff wins only on genuinely fresh startup.
Trust the project to load resources and check native `/mcp` for an actual
connection; package discovery/registration alone is not connection evidence.
An absent/stale build gives a checkout-specific `pnpm build` diagnostic rather
than silently loading old dist. The native extension loads separately from
core tsc output; `pnpm build` alone is not proof it loaded in Pi.

Use `mise exec -- pnpm mypi --help` for local administrative CLI without global
installation. `mise exec -- pnpm pi --project org/project --cwd /existing/worktree`
remains an explicit launch alternative; Pi arguments follow `--`. Neither
route creates projects, worktrees or requests. In a root conversation,
`/mypi open [org/project]` selects a registered project and real existing Git
worktree. An agent can call `mypi_project_open`: first list choices, then pass
explicit `project` and absolute `worktree`; ambiguous choices are returned for
clarification. Both routes share the project-open use case and submit a new
Herdr tab while leaving the originating conversation open. A known observed
session requires focus, another worktree or explicit approval for an additional
session. Submission is not readiness: check the new tab's cwd/context/native ID
and `/mcp`; retain any partial Herdr IDs on failure and inspect state before
retrying. Without Herdr, ordinary Pi and local CLI still work. See
[cooperative Pi](docs/COOPERATIVE-PI.md) and [native context](docs/PI-WORK-CONTEXT.md).

### Explicit workspace helpers

`mypi workspace prepare`, `inspect`, `commit` and `publish` share application
contracts with MCP. Supply a registered project and an independent base clone;
prepare creates only the explicitly requested branch/worktree, commit selects
literal files while preserving unrelated staged content, and publish confirms a
single non-force remote ref. They do not run checks, create requests, switch the
base branch, retry, merge or replace normal Git. See [arguments and partial
outcomes](docs/M1-CLI.md#explicit-git-workspace-helpers).

### Coordinated ordinary home documents

For an authorized change to an existing tracked ordinary UTF-8 document, prefer
`mypi home document-patch <path> <text> --expected <SHA256>` (MCP
`home_document_patch`). Supply the exact existing byte hash and full replacement;
no creation/deletion or managed memory/history rewrite is supported. Inspect
`home status` / `home reconcile` after uncertain outcomes; they never replay writes.
These are explicitly **home-wide operator routes**, outside project membership
and defaults. Native edit/shell/manual Git remain uncoordinated maintenance; do not
run them concurrently with the writer. See [prerequisites and limits](docs/HOME-WRITER.md).
No settings change or runtime activation is implied.

### Existing installations

Select an existing ordinary home Git (including the ignored `home/` directory)
without relocating or rewriting its data. Symlinked home roots are not supported
by the storage guards. Existing local `.pi` customization is retained where
compatible; conflicting paths and non-owned links require explicit reconciliation.
A legacy `.pi -> home/pi` conversion preserves the old target bytes. No automatic
merge or deletion of arbitrary user configuration is attempted.

### Where to customize

| Change | User-owned location |
|---|---|
| Personal agent instructions | `<selected-home>/USER-INSTRUCTIONS.md` |
| Shared Pi settings and package resource filters | `<selected-home>/pi/settings.json` |
| Installation package selection and local overrides | `.pi/settings.json` (reviewed projection) |
| Additional MCP servers / built-in server overrides | `<selected-home>/pi/mcp.json` or explicit local `.pi/mcp.json` |
| Skills | `<selected-home>/pi/skills/<name>/SKILL.md` |
| Extensions | `<selected-home>/pi/extensions/` |
| Prompt templates and themes | `<selected-home>/pi/prompts/`, `<selected-home>/pi/themes/` |
| Project knowledge | `<selected-home>/projects/<org>/<project>/` |
| Project source code | `projects/<org>/<project>/`, its own Git |
| Task worktrees | `projects/<org>/<project>--<task-slug>/` |

For baseline versus personal instruction ownership, see
[AGENTS.md](AGENTS.md#instruction-ownership).

All of `.pi`, `.mypi-local.json`, `home/` and `projects/` are reserved local paths,
ignored by engine Git. Do not customize files under `integrations/pi/` unless contributing to
the engine. Package resources load directly from there without being copied into
home. Use distinct names for personal resources; to replace a built-in resource,
exclude it via Pi package filters and load your own implementation explicitly.

**Why does Pi discover `integrations/pi`?** The directory name has no special meaning.
Bootstrap explicitly adds a local package entry to `.pi/settings.json`, for example:

```json
{ "packages": ["/absolute/path/to/mypi/integrations/pi"] }
```

Pi reads that directory's `package.json`, whose `pi` manifest declares
`extensions: ["./extensions/mypi.ts"]` and `skills: ["./skills"]`. After project trust,
Pi automatically loads the extension and lists the skills' names/descriptions for
the agent; full skill instructions are read when needed. Without the package entry,
Pi does not discover this arbitrary directory. MCP tools arrive via the registered
server, not by scanning a folder of tool files. Their schemas use the configured
exposure (mostly codemode; project resolution and warmup are direct).

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

The installed engine is not a development checkout; contribute through the
[common project workflow](AGENTS.md#common-project-workflow). Once changes have
been merged, update a clean installation on its release branch with
`git pull --ff-only`, install the locked dependencies, build, then reload/restart Pi. Updates replace
built-in resources only; they never regenerate user settings or rerun bootstrap.
Data-format migrations require a separate explicit operation. If the checkout
moves, reconcile the binding and local package selection explicitly; setup does not
silently adopt another engine. Compatibility with future Pi APIs
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
├── integrations/pi/             # tracked built-in Pi package: extensions + skills
├── .pi/                        # ignored local Pi settings/resource projection
├── .mypi-local.json            # ignored installation binding
├── home/                        # optional location for separate ignored context Git
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
└── projects/                    # ignored project code, not project knowledge
    └── <org>/
        ├── <project>/           # independent base clone
        └── <project>--<task>/    # task worktree of that clone

<selected external database>       # outside engine and home Git
<selected external state root>/sessions, /mailbox
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
