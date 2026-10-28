# mypi architecture

Local memory, organizations/projects and task accounting. TypeScript strict,
Node.js 24 LTS, ESM/tsc, pnpm, SQLite + better-sqlite3, SQL migrations without ORM.
One package: modular monolith, Ports & Adapters, use cases within domain modules.

[AGENTS](../AGENTS.md) defines development guidance; the former mandatory agent
workflow is [withdrawn](AGENT-WORKFLOW.md). [PLAN](../PLAN.md) separates implemented capability from future milestones.
M0 was accepted; M1 is functionally implemented, but final acceptance still needs the
independent App issuer/trusted gate. [M1-CYCLE](M1-CYCLE.md) and [MCP-CYCLE](MCP-CYCLE.md)
record evidence. Historical contracts describe their time, not extra current commands.

## 1. Product and operating boundaries

Implemented: registry/checkout resolution, memory/capture/notes/errors, glossary,
scoped warmup/history, task cards/statuses/progress, local context commits,
SQLite backup and checked restore; CLI and stdio MCP over shared AppCommand.

The memory/task APIs are optional data operations. They do not impose agent
startup, task registration, logging or Herdr tabs before work. The instruction-driven
workflow has been withdrawn; existing cards, immutable sources and storage/API
contracts, including nullable project_id, are unchanged.

Flow is part of the intended system. Automated flow execution, agent runner, scoped
agent permissions, task execution queue, session catalog, multi-device and network
sync are not implemented. Current scope is data selection, not a security perimeter.
No mandatory external tracker, HTTP daemon or implied automatic execution.

## 2. Code and dependencies

```text
src/
├── cli/                 # argv -> AppCommand, JSON, exit
├── mcp/                 # SDK stdio, schemas, envelopes, serial calls
├── app/                 # composition, mixed operations, warmup, backup/restore
├── modules/
│   ├── projects/        # registry, identity, checkout and scope
│   ├── tasks/           # cards, numbering, status dictionary
│   ├── memory/          # facts
│   ├── inbox/           # immutable capture
│   └── knowledge/       # journal, notes and errors
├── infrastructure/      # SQLite, files and Git
└── shared/              # scope types, errors and partial
```

CLI/MCP → app → public domain APIs. A module uses its own rules/ports; adapters
implement ports with technical infrastructure; composition roots select adapters.
Domain rules do not perform IO. Modules do not bypass each other's public API.
App coordinates persistence boundaries; CLI/MCP do not duplicate business logic.
Imports do not execute CLI. dependency-cruiser checks directions/cycles.
No DI framework, event bus, CQRS, generic repository or speculative recovery engine.
See [M1-DESIGN](M1-DESIGN.md) before changing structure/dependencies.

## 3. Data authorities and layout

SQLite owns state and relationships:

```text
organizations(id, slug)
projects(id, org_id, slug, code, checkout_path)
task_statuses(id, code, is_terminal)
tasks(id, project_id, number, title, status_id,
      context_dir, worktree_path, created_at, updated_at)
```

Four STRICT tables, INTEGER PK, FK/unique/check/triggers, transactional SQL migrations
with user_version. Statuses are seeded once. Future unknown schemas are rejected;
readonly opens do not create missing DBs. Explicit `db init` enables WAL outside the
schema transaction; ordinary opens do not change journal mode. SQLite may create its
own `state.sqlite3-wal`/`state.sqlite3-shm` sidecars in the private state directory
even for a readonly connection; readonly means no user-data, schema or context write.
An unwritable location without required WAL artifacts may return SQLite's error;
there is no automatic initialization or workaround. Path: $XDG_STATE_HOME/mypi/state.sqlite3,
fallback ~/.local/state/mypi/state.sqlite3. DB/snapshots must be outside engine/context
Git, including symlink aliases; created parent directories 0700 and DB 0600.

Files own knowledge and original source:

```text
home/                           # separate ignored Git inside the engine clone
├── MEMORY.md
├── inbox/<UTC>-<UUID>.md
├── notes/<UTC>-<UUID>.md
├── journal/YYYY-MM.jsonl      # legacy, retained unchanged after explicit import
├── tasks/REQ-number-slug/     # legacy standalone records
│   ├── source.md
│   └── <artifact-path>
└── projects/<org>/
    ├── MEMORY.md
    ├── notes/<UTC>-<UUID>.md
    └── <project>/
        ├── MEMORY.md, context.md, errors.md
        ├── notes/
        └── tasks/CODE-number-slug/
            ├── source.md
            └── <artifact-path>
```

Homes created before v2 keep task folders under requests/ in both places until mypi home
migrate-tasks moves them in one commit and rewrites the stored paths; every reader accepts
both layouts.

home/projects is context, not the working-clone directory projects/. Engine code stays
in its checkout; using project/task context is not a prerequisite for development.
Source/progress are not duplicated in SQL fields; the journal event text and file
fingerprints live in SQLite. There is no per-task journal/status.md.
Personal context is not part of the engine repository and is not moved by cleanup.

## 4. Projects, tasks and statuses

org/project is identity; canonical checkout is optional metadata. Project code is
unique uppercase letters; REQ is reserved. Code cannot change after tasks exist.
Title does not rename a key/folder. Task ID and local number are distinct.
MAX+1 allocation uses BEGIN IMMEDIATE before source creation; task deletion and
number reuse are not provided. Null project_id (legacy REQ records) uses independent
REQ numbering and task scope, not a fake project/global scope. New tasks require a
project; the API does not reassign one.

Initial status is explicit. DB dictionary, not fixed code enum/pipeline, determines
validity/terminality. Used statuses cannot be deleted or have terminality changed;
renaming preserves stable IDs and is not task progress. Same status is a no-op.
Terminal tasks do not reopen; continuation is a new explicitly linked record.
[M1-REQUESTS](M1-REQUESTS.md) contains the storage contract and decision history of the request era.

## 5. Memory, journal and warmup

Managed MEMORY facts are Markdown lines containing JSON strings (`- "JSON string"`);
multiline text is escaped and returned exactly. Other Markdown remains context.
Capture preserves exact original text in an immutable file, including BOM/CRLF.
Notes have unique paths; errors append rather than rewrite.

Journal: ordered append-only SQLite rows in the task database, with required
at/scope/event_type/text and optional home-relative artifacts. Types:
note/task_created/status_changed. Events do not launch flow. Existing monthly
JSONL files are read only by explicit `journal import`; originals remain untouched.
Stop old writers before cutover. Import rejects changed or corrupt input and retains
legitimate duplicate entries. Legacy source/artifact fingerprints require unchanged,
published files; reconcile dirty legacy files separately.

Selection: global only global; org includes projects/tasks; project includes its
tasks; task only itself; all is explicit. Relations resolve through DB; relevant
months are selected and filtered before the overall sort/limit.
Warmup (`mypi warmup`, MCP `warmup`) prints a session's starting context as Markdown in
a fixed order: personal instructions (`home/USER-INSTRUCTIONS.md`, omitted when absent),
the scope's role (`integrations/prompts/global.md`, `project.md` or `task.md`), how to
work in mypi (`integrations/prompts/howto.md`), zone memory (global: `MEMORY.md`;
project: organization and project `MEMORY.md`; task: project `MEMORY.md`), then the
project list (global), the open tasks (project) or the task card with its worktree
(task). Scope: `--scope`, else `MYPI_SCOPE`, else `global`; keys are `global`, `CODE`
and `CODE-N`. Unknown keys, legacy REQ tasks and projects without a clone are errors.
Embedded files are inserted as written, except that their ATX headings outside fenced code
blocks are demoted below the enclosing warmup heading (by two levels under a section, by
three under a memory file's path, at most to level six).
Reads create no DB rows, files or Git state. Scope is not an ACL.

The output is limited to 64 KiB of UTF-8. Only memory facts are cut: never the
personal instructions, role, how-to, project list, task list, task card or worktree,
and never the hand-written text of a `MEMORY.md`. The farthest zone loses facts first
(global, then organization, then project); within a file the oldest facts go first.
In their place a line states how many facts were hidden, from which file, and the
`memory_show` call (with the CLI command after it) that reads them in full. If the parts that are never cut
already exceed the limit, every fact is hidden, a note says so, and the output is
printed in full above the limit.

## 6. Persistence and partial outcomes

- DB-only: transaction, independent of workspace/Git, no empty commit.
- Context changes: safe file writes and commits of exact operation paths.
- Task create: source file first; task row, source fingerprint and event commit
  together in SQLite. SQL failure discloses the orphaned source.
- Status/title: task row and event commit together. Progress: files first, then
  fingerprints, event and activity timestamp in one SQLite transaction.
  Task/journal saves do not invoke Git; local success is not publication or backup.

No global SQLite/FS/Git atomicity. Partial reports saved/missing work, paths and
taskId when known. CLI exits nonzero; MCP returns an error/partial envelope.
Do not automatically repeat append/create, roll back a saved card or delete source.
Inspect first, then complete checked files' commit, strict source adoption, factual
recovery note instead of invented transition, or explicit touch as appropriate.

Filesystem guards reject traversal, symlink/hardlink aliases and implicit overwrite.
Git preserves unrelated staged changes and avoids hooks/fsmonitor/signing/network.
Private attributes prevent EOL/encoding/filter transforms. Source/inbox are immutable;
errors append-only. Registered sources and artifacts are checked against insert-only
SHA-256/byte-count fingerprints before reuse, backup and context publication.
New versions get new paths. Mutable context can be
restored from a full Git revision by making a new commit, not rewriting history.

## 7. Backup and restore

SQLite backup API with cooperating-writer lock, clean context Git bundle and checksum
manifest after reference/pair checks. DB-only backup needs no home. Restore only into
absent DB/home, with checksum/schema/integrity/FK and source/artifact checks; no overwrite.
Manual `backup --publish` additionally captures SQLite plus exact selected/required
home files in `.mypi-backup/`, the sole generated-backup-in-home exception; the live
DB stays external. It builds an immutable home commit and pushes to existing origin/main
after releasing the DB writer lock. Publication can be partial, not cross-store atomic;
older binary snapshots remain in Git history. Restore from a selected commit in a
local clone verifies the snapshot and references before installing into absent targets.
Git is not whole-system backup and cannot restore unsaved data. Scheduling, retention,
automatic network sync and personal initialization require explicit action. See [M1-CLI](M1-CLI.md).

## 8. Verification and future execution

[TESTING](TESTING.md) is the sole test-policy source: fast/boundary, mandatory verify,
systemd/cgroup v2 + bubblewrap, no personal data/network. Do not raise limits for green
or run an unbounded fallback. Admission is not proof of sandbox security.
Rules are checked through APIs and real SQLite/FS/Git/CLI/MCP boundaries; build-state
rejects stale dist. Product suites do not run LLMs or nested suites. Ordinary hosted CI
is not the independent trusted gate ([M1-CI](M1-CI.md)); local file/DB owners and GitHub
admins remain trusted. Evidence does not claim final production acceptance.

A future unit defines role, interface, restrictions and acceptance. Flow composes units;
runtime validates permissions/results and persists state. Root/org/project coordination
and task workers should receive relevant context and explicit capabilities. No
mandatory LLM process per level, automatic status-triggered execution, process-tree
ownership guarantee or universal human-only acceptance is implemented or assumed.
