# mypi architecture

A home knowledge tree, organizations/projects and task accounting. TypeScript strict,
Node.js 24 LTS, ESM/tsc, pnpm, SQLite + better-sqlite3, SQL migrations without ORM.
One package: modular monolith, Ports & Adapters, use cases within domain modules.

[AGENTS](../AGENTS.md) defines development guidance; the former mandatory agent
workflow is [withdrawn](AGENT-WORKFLOW.md). [PLAN](../PLAN.md) separates implemented capability from future milestones.
M0 was accepted; M1 is functionally implemented, but final acceptance still needs the
independent App issuer/trusted gate. [M1-CYCLE](M1-CYCLE.md) and [MCP-CYCLE](MCP-CYCLE.md)
record evidence. Historical contracts describe their time, not extra current commands.

## 1. Product and operating boundaries

Implemented: registry/checkout resolution, knowledge entries/capture/notes/errors, glossary,
scoped warmup/history, task cards/statuses/progress, task worktrees beside registered clones, local context commits,
SQLite backup and checked restore; CLI and stdio MCP over shared AppCommand; MCP exposes seventeen agent tools, each translating to one or more AppCommands, and maintenance is CLI-only.

The task and knowledge APIs are optional data operations. They do not impose agent
startup, task registration, logging or Herdr tabs before work. The instruction-driven
workflow has been withdrawn; existing cards, sources and storage/API
contracts, including nullable project_id, are unchanged.

Flow is part of the intended system. Automated flow execution, agent runner, scoped
agent permissions, task execution queue, session catalog, multi-device and network
sync are not implemented. Current scope is data selection, not a security perimeter.
No mandatory external tracker or implied automatic execution. `mypi serve` is an optional foreground HTTP API over AppCommand (docs/HTTP-API.md), not a daemon the engine starts. It also serves the read-only web UI (web/, built into dist/ui).

## 2. Code and dependencies

```text
src/
├── cli/                 # argv -> AppCommand, JSON, exit
├── mcp/                 # SDK stdio and remote Streamable HTTP, schemas, envelopes, serial calls
├── http/                # node:http server (own entry main.ts, spawned by mypi serve), bearer tokens, /v1 routes, SSE changes, /mcp mount
├── app/                 # composition, mixed operations, warmup, backup/restore
├── modules/
│   ├── projects/        # registry, identity, checkout and scope
│   ├── tasks/           # cards, numbering, status dictionary
│   ├── inbox/           # immutable capture
│   ├── sessions/        # session rows, live registry records, key resolution
│   ├── events/          # turn-end, waiting and milestone events from task chats to their project
│   └── knowledge/       # journal, notes and errors
├── infrastructure/      # SQLite, files, home Git and project clone Git, Herdr CLI, event socket
└── shared/              # scope types, errors and partial
```

web/ — browser UI package (React, Mantine, Vite; Feature-Sliced Design layers app → pages → widgets → features → entities → shared), built into dist/ui and served by src/http/web.ts.

tui/ — terminal UI (Rust, ratatui): a separate binary that reads only the HTTP API (src/http) and opens tabs by running mypi open; docs/TUI.md.

CLI/MCP/HTTP → app → public domain APIs. A module uses its own rules/ports; adapters
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
      context_dir, worktree_path, parent_id, created_at, updated_at)
sessions(key, scope_type, project_id, task_id, agent, native_id, created_at)
events(id, from_key, to_key, kind, message, created_at, delivered_at)
```

`events` rows are addressed from a task key to a parent key — the sender of the parent message that started the turn when it is a parent of the task (its project or its organization), else its project; a milestone to the parent that last sent the task a message, else its project — except `message` rows, which go down from a parent key to its direct child (project or organization → task, `global` → project or organization) through `sendMessage` (`src/app/events.ts`) and `/open --message`; `deliverOnOpen` (`src/app/delivery.ts`) sends a child's queued messages once when `/open` starts or resumes it, in one message with the start text, and the warmup skips them. The Claude Stop and Notification hooks (`mypi turn end`, `mypi event emit --waiting --hook`) and the Pi extension (`mypi event emit`) add `turn_end` and `waiting` rows only in a turn a parent message started (Claude: the transcript entry that opened the turn has `turnOrigin` `peer` and the mypi parent-message frame; Pi: a batch with that frame arrived through its socket); `idle_prompt` adds nothing. A task status change to `review`, `blocked`, `merged` or a terminal status adds a `milestone` row in the same transaction, unless the caller is its recipient. After recording, `deliverPending` (`src/app/delivery.ts`) sends the parent's undelivered events except milestones, which wait for `/inbox` and the warmup, through the `EventTransport` port of the events module chosen by the agent of the parent's canonical live record; two transports, the Pi socket client and the Claude inbox client, both in `src/infrastructure/socket/`, are wired in from `src/cli/main.ts` and `src/mcp/main.ts`, and acknowledged events are marked delivered. `deliverToStarted` (`src/app/delivery.ts`) sends the start message of a session `/open` started through the same `EventTransport` once its live record appears (up to 10 s), and writes nothing to the database. Six STRICT tables, INTEGER PK, FK/unique/check/triggers, transactional SQL migrations
with user_version. Statuses are seeded once. Future unknown schemas are rejected;
readonly opens do not create missing DBs. Explicit `db init` enables WAL outside the
schema transaction; ordinary opens do not change journal mode. SQLite may create its
own `state.sqlite3-wal`/`state.sqlite3-shm` sidecars in the private state directory
even for a readonly connection; readonly means no user-data, schema or context write.
An unwritable location without required WAL artifacts may return SQLite's error;
there is no automatic initialization or workaround. Path: $XDG_STATE_HOME/mypi/state.sqlite3,
fallback ~/.local/state/mypi/state.sqlite3. DB/snapshots must be outside engine/context
Git, including symlink aliases; created parent directories 0700 and DB 0600.

The live session registry is not state: $XDG_RUNTIME_DIR/mypi/sessions/<key>.json, owner-only, one record per live agent process; a record is live only while its pid and process start match /proc; reads skip dead records and the next registration, unregistration or forget deletes them.

The conversation archive is not state either: `archive.sqlite3` beside `state.sqlite3` (same directory, refused inside the engine or context Git like the DB), file 0600 in a 0700 directory, its own `user_version` and migrations (`src/infrastructure/database/archive-migrations/`), three tables `archive_sessions` (one row per agent and native id with the key, its source and the read offset `bytes_read`), `archive_messages` and the FTS5 index `archive_fts` kept in step by triggers. It holds only the human turns and final answers that the readers in `src/infrastructure/transcript/` take from Claude and Pi transcripts — no reasoning, tool calls or subagents — bound to a scope key through the `sessions` row, else a registered session name, else unbound. `archive import` and live capture (Claude Stop and SessionEnd hooks, the Pi extension on `agent_settled`) fill it from each file's saved offset; `archive_search` and `archive_show` read it; the key is a search filter, not an ACL. It is kept indefinitely with no age or size limit and nothing to configure; text is stored as written, without redaction or publication. Only `mypi archive forget` deletes from it; deleting the whole file is safe: the next import or capture recreates it and rereads every native transcript that still exists.

Files own knowledge and original source:

```text
home/                           # separate ignored Git inside the engine clone
├── INDEX.md
├── inbox/<UTC>-<UUID>.md
├── notes/<UTC>-<UUID>.md
├── journal/YYYY-MM.jsonl      # legacy, retained unchanged after explicit import
├── tasks/REQ-number-slug/     # legacy standalone records
│   ├── source.md
│   └── <artifact-path>
└── projects/<org>/
    ├── INDEX.md
    ├── notes/<UTC>-<UUID>.md
    └── <project>/
        ├── INDEX.md, context.md, errors.md
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
Source/progress are not duplicated in SQL fields; the journal event text and the file
fingerprints of old plain-path entries live in SQLite. There is no per-task journal/status.md.
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
renaming preserves stable IDs and is not task progress. A repeated status changes
nothing on the card and leaves a `note` `<status> (unchanged). <reason>` in the task
journal; a repeated title writes nothing.
Terminal tasks do not reopen; continuation is a new explicitly linked record.
[M1-REQUESTS](M1-REQUESTS.md) contains the storage contract and decision history of the request era.

## 5. Knowledge entries, journal and warmup

Capture preserves exact original text in an immutable file, including BOM/CRLF.
Notes have unique paths; errors append rather than rewrite.

Journal: ordered append-only SQLite rows in the task database, with required
at/scope/event_type/text and optional home-relative artifacts. Types:
note/task_created/status_changed/title_changed/worktree_created/session_opened/message_sent/clone_prepared.
A type other than note is allowed only in the scopes of its fact: task facts in a
task, `clone_prepared` in a project, `session_opened` and `message_sent` in a task,
project or organization. Events do not launch flow. Existing monthly
JSONL files are read only by explicit `journal import`; originals remain untouched.
Stop old writers before cutover. Import rejects changed or corrupt input and retains
legitimate duplicate entries. Imported plain-path artifacts keep fingerprints that
require unchanged, published files; reconcile dirty legacy files separately.

Journal and archive: the journal keeps short scoped append-only facts and outcomes — what was decided or done, under which key, with which artifact; the conversation archive keeps the verbatim human turns and final answers, bound to a key through `sessions`. A journal entry may point to a conversation (session key and time) but never quotes it; the archive never replaces a status or an outcome entry. The warmup and the start message stay on the journal and `events`; the archive is reached only through search.

Selection: global only global; org includes projects/tasks; project includes its
tasks; task only itself; all is explicit. Relations resolve through DB; relevant
months are selected and filtered before the overall sort/limit.
Warmup (`mypi warmup`, MCP `warmup`) prints a session's starting context as Markdown in
a fixed order: personal instructions (`home/USER-INSTRUCTIONS.md`, omitted when absent),
the scope's role (`integrations/prompts/global.md`, `org.md`, `project.md` or `task.md`), how to
work in mypi (`integrations/prompts/howto.md`: a map of where to look, the write rules
and the paragraph on keeping knowledge by progressive disclosure, the one place those
concepts are stated), the knowledge
entries: the entry of every level from global down to the scope's own (global: `INDEX.md`;
organization: global and `projects/<org>/INDEX.md`; project and task: global, organization
and `projects/<org>/<project>/INDEX.md`), each under a `###` heading with its home-relative
path, then the project
list (global), one line per project of the organization with its clone or `no clone`
and its open tasks counted by status (organization), the open tasks (project) or the
task card with its worktree (task).
Then «Журнал»: in a project scope one line with the number of journal entries of the project and all its tasks and the local date of the newest (`stats` of the SQLite journal store, one SQL statement; «Записей в журнале проекта нет.» when none), in a task scope the task's last five entries (`last`, newest last; date, time, type, text up to 300 characters, an artifacts line), «Записей в журнале задачи нет.» when none; both end with the `journal` call with `limit` 20 and its CLI form that read more. Neither reader goes through `createJournal().read`, which resolves every row's scope.
A project or organization warmup then adds «Новые
события» — the undelivered events addressed to that key, each in its frame — and «Последние доклады» — the last `turn_end` of each
open task delivered before this warmup, as history; empty blocks are omitted. Scope: `--scope`, else the session's registered key (row by native id from CLAUDE_CODE_SESSION_ID or PI_SESSION_ID, else the live record of the parent process), else `MYPI_SCOPE`, else `global`; keys are `global`, an organization slug, `CODE`
and `CODE-N` (`all` is not a key). Unknown keys, legacy REQ tasks and projects without a clone are errors.
Embedded files are inserted as written, except that their ATX headings outside fenced code
blocks are demoted below the enclosing warmup heading (by two levels under a section, by
three under an entry's path, at most to level six).
A level's entry is `INDEX.md` in its home folder; a task's entry is its card (`source.md`).
This location is the only thing the engine fixes: sections, names and branches below the
entry belong to the level. An entry is shown whole; a missing or whitespace-only entry is
shown as one line `> No entry yet. Create <path> (owner: <chat>): …` naming the chat that
keeps it (global: the main chat; organization: the organization chat; project: the project
chat). A link in place of an entry fails the warmup, as for every context file.
Warmup creates no rows, files or Git state; a project or organization warmup sets `delivered_at` of the events it shows in full. Scope is not an ACL.

The output is limited to 64 KiB of UTF-8 or, with `--max-chars n` (1–21845, CLI only),
to n characters counted as UTF-16 code units, the unit Claude Code measures; 21845
characters always fit 64 KiB. Both limits cut the same way.
Never cut: the personal instructions, role, how-to, invitation lines, project list, task
list, the task card's key, title, status and context lines, worktree, the project's journal
line, the task journal heading with its count and loader. Entries are clipped from their end,
the farthest first (global, then organization, then project), each closing a fence the clip
leaves open and ending with a line naming the `context_read` call (and its CLI command) that
reads the entry in full; a fully clipped entry is only that line. If the parts that are never
cut already exceed the limit, every entry, new event and the card are clipped, a note says
so, and the output is printed above the limit. A project or organization warmup over the
limit cuts in this order: the texts of the last reports to 280 characters, then the last
reports one by one from the oldest — «Последние доклады» then ends with a line counting the
reports left out, naming their task keys and the `events` call (CLI `mypi event list`) that
reads them; the section stays even when all are left out — then the entries as above, then
new events from the newest, which stay undelivered and are counted in a line pointing to
`/inbox`; only then the note. A task warmup over the limit drops the shown journal entries
from the oldest, then clips the entries, then the end of the card with its `context_read`
line; only then the note.

The Claude Code SessionStart hook passes `--max-chars 9500`, below Claude Code's
10,000-character limit for hook output. Hook output above that limit (only possible
when the parts that are never cut exceed the budget) Claude Code saves to a file and
puts a 2,000-character preview with the file path into the context.

## 6. Persistence and partial outcomes

- DB-only: transaction, independent of workspace/Git, no empty commit.
- Context changes: safe file writes and commits of exact operation paths.
- Task create: source file first; task row and event commit together in SQLite.
  SQL failure discloses the orphaned source.
- Status/title: task row and event commit together. Progress: files first, then a
  home commit of the named files (no push), then event and activity timestamp in one
  SQLite transaction. Other task/journal saves do not invoke Git; local success is
  not publication or backup.

No global SQLite/FS/Git atomicity. Partial reports saved/missing work, paths and
taskId when known. CLI exits nonzero; MCP returns an error/partial envelope.
An MCP task_update runs status, title and progress as separate commands in one serial slot; a failure after an earlier part saved is a partial envelope naming the saved and missing parts.
Do not automatically repeat append/create, roll back a saved card or delete source.
Inspect first, then complete checked files' commit, strict source adoption, factual
recovery note instead of invented transition, or explicit touch as appropriate.

Filesystem guards reject traversal, symlink/hardlink aliases and implicit overwrite.
Git preserves unrelated staged changes and avoids hooks/fsmonitor/signing/network.
Private attributes prevent EOL/encoding/filter transforms. Inbox is immutable;
errors append-only. Only old plain-path artifacts are checked against insert-only
SHA-256/byte-count fingerprints before reuse, backup and context publication; new
artifacts are `{path, commit}` references that backup checks against the home history. Mutable context can be
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
automatic network sync and personal initialization require explicit action. The conversation
archive `archive.sqlite3` is outside backup, `backup --publish` and restore: a backup
snapshots only `state.sqlite3` and the context bundle, and restore accepts only those; the
archive is a local copy of native transcripts and `mypi archive forget` is its only deletion.
See [M1-CLI](M1-CLI.md).

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
