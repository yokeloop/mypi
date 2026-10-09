# mypi architecture

Local memory, organizations/projects and request accounting. TypeScript strict,
Node.js 24 LTS, ESM/tsc, pnpm, SQLite + better-sqlite3, SQL migrations without ORM.
One package: modular monolith, Ports & Adapters, use cases within domain modules.

[AGENTS](../AGENTS.md) defines development guidance; the former mandatory agent
workflow is [withdrawn](AGENT-WORKFLOW.md). [PLAN](../PLAN.md) separates implemented capability from future milestones.
M0 was accepted; M1 is functionally implemented, but final acceptance still needs the
independent App issuer/trusted gate. [M1-CYCLE](M1-CYCLE.md) and [MCP-CYCLE](MCP-CYCLE.md)
record evidence. Historical contracts describe their time, not extra current commands.

## 1. Product and operating boundaries

Implemented: registry/checkout resolution, memory/capture/notes/errors, glossary,
scoped warmup/history, request cards/statuses/progress, exact context commits and coordinated managed home publication,
SQLite backup and checked restore; CLI and stdio MCP over shared AppCommand.
Native Pi working context supplies supported write/edit guards; contextual application
calls apply membership/default checks. Explicit workspace helpers prepare, inspect,
commit exact files and publish a selected ref without running an automatic workflow.

The memory/request APIs are optional data operations. They do not impose agent
startup, task registration, logging or Herdr tabs before work. The instruction-driven
workflow has been withdrawn; existing cards, immutable sources and storage/API
contracts, including nullable project_id, are unchanged.

Flow is part of the intended system. Automated flow execution, agent runner, scoped
agent permissions, task execution queue, authoritative session catalog, multi-device and network
sync are not implemented. A bounded [session observation cache](SESSION-CARDS.md)
provides project/default or explicit operator list/show/archive views without
storing native history or claiming process ownership. A bounded local
[mailbox](MAILBOX.md) queues explicit cooperative messages by native Pi ID without
starting agents or storing transcripts. Current scope is data selection, not a security perimeter.
The [cooperative policy core](SCOPED-POLICY-CORE.md) adds strict YAML v2 validation,
ordinary project/organization/unrestricted working context, verified repository
association and shared validate/explain diagnostics. Its MP-9 consumers implement
[native write/edit guards](PI-WORK-CONTEXT.md#cooperative-native-writeedit-guards),
[application membership/defaults](MCP.md#cooperative-application-membership-and-defaults)
and [explicit workspace operations](M1-CLI.md#explicit-git-workspace-helpers).
Only documented operations are guarded, not blanket-denied. These settings are not
authentication or OS isolation. The separate [managed home writer](HOME-WRITER.md)
coordinates only the documented shared CLI/MCP mutation routes.
No mandatory external tracker, HTTP daemon or implied automatic execution.

## 2. Code and dependencies

```text
src/
├── cli/                 # argv -> AppCommand, JSON, exit
├── mcp/                 # SDK stdio, schemas, envelopes, serial calls
├── app/                 # composition, mixed operations, warmup, backup/restore
├── modules/
│   ├── mailbox/         # pure envelope, expiry and observation rules
│   ├── session-cards/   # pure observation transitions and age, not runtime ownership
│   ├── work-context/    # pure working selection and warn/block guard settings
│   ├── projects/        # registry, identity, checkout, scope and repository evidence
│   ├── requests/        # cards, numbering, status dictionary
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
Guard policy text parsing/loading is separate from subprocess-based repository
verification; Git verification is not imported through createApp or fast paths.
CLI/MCP policy diagnostics and workspace operations share AppCommand contracts.
Application membership checks use current registry/card relationships before dispatch;
Git workspace effects remain in separate application composition and a Git adapter.
Native guards read the current Pi branch selection through a small tool-call adapter.
There is no universal effect/authority inventory or shell interception.
No DI framework, event bus, CQRS, generic repository or speculative recovery engine.
See [M1-DESIGN](M1-DESIGN.md) before changing structure/dependencies.

## 3. Data authorities and layout

SQLite owns state and relationships:

```text
organizations(id, slug)
projects(id, org_id, slug, code, checkout_path)
request_statuses(id, code, is_terminal)
requests(id, project_id, number, title, status_id,
         context_dir, created_at, updated_at)
```

Four STRICT tables, INTEGER PK, FK/unique/check/triggers, transactional SQL migrations
with user_version. Statuses are seeded once. Future unknown schemas are rejected;
readonly opens do not create missing DBs. Path: $XDG_STATE_HOME/mypi/state.sqlite3,
fallback ~/.local/state/mypi/state.sqlite3. DB/snapshots must be outside engine/context
Git, including symlink aliases; created parent directories 0700 and DB 0600.

Files own knowledge and original source:

```text
home/                           # separate ignored Git inside the engine clone
├── MEMORY.md
├── inbox/<UTC>-<UUID>.md
├── notes/<UTC>-<UUID>.md
├── journal/YYYY-MM.jsonl
├── requests/REQ-number-slug/
│   ├── source.md
│   └── <artifact-path>
└── projects/<org>/
    ├── MEMORY.md
    ├── notes/<UTC>-<UUID>.md
    └── <project>/
        ├── MEMORY.md, context.md, errors.md
        ├── notes/
        └── requests/CODE-number-slug/
            ├── source.md
            └── <artifact-path>
```

home/projects is context, not the working-clone directory projects/. Engine code stays
in its checkout; using project/request context is not a prerequisite for development.
Source/progress are not duplicated in SQL fields; no per-task journal/status.md.
Personal context is not part of the engine repository and is not moved by cleanup.

## 4. Projects, requests and statuses

org/project is identity; canonical checkout is optional metadata. Project code is
unique uppercase letters; REQ is reserved. Code cannot change after tasks exist.
Title does not rename a key/folder. Request ID and local number are distinct.
MAX+1 allocation uses BEGIN IMMEDIATE before source creation; request deletion and
number reuse are not provided. Null project_id uses independent REQ numbering and
request scope, not a fake project/global scope. The API does not currently reassign it.

Initial status is explicit. DB dictionary, not fixed code enum/pipeline, determines
validity/terminality. Used statuses cannot be deleted or have terminality changed;
renaming preserves stable IDs and is not request progress. Same status is a no-op.
Terminal requests do not reopen; continuation is a new explicitly linked record.
[M1-REQUESTS](M1-REQUESTS.md) contains the storage contract and decision history.

## 5. Memory, journal and warmup

Managed MEMORY facts are Markdown lines containing JSON strings (`- "JSON string"`);
multiline text is escaped and returned exactly. Other Markdown remains context.
Capture preserves exact original text in an immutable file, including BOM/CRLF.
Notes have unique paths; errors append rather than rewrite.

Journal: common append-only JSONL, monthly UTC rotation, required at/scope/event_type/
text and optional home-relative artifacts. Types: note/request_created/status_changed.
Events do not launch flow. Corrupt/unfinished lines are not silently ignored.

Selection: global only global; org includes projects/requests; project includes its
requests; request only itself; all is explicit. Relations resolve through DB; relevant
months are streamed and filtered before the overall sort/limit. No SQL history index/copy.
Warmup inherits parent MEMORY, not global inbox or sibling content. It returns an index
and paths, not complete history. Reads do not create DB/files. Scope is not an ACL.

## 6. Persistence and partial outcomes

- DB-only: transaction, independent of workspace/Git, no empty commit.
- Context changes: safe file writes and commits of exact operation paths.
- Request create: source → DB commit → journal → Git.
- Status/title: DB → journal → Git; progress: files/journal → Git → activity timestamp.

No global SQLite/FS/Git atomicity. Partial reports saved/missing work, paths and
requestId when known. CLI exits nonzero; MCP returns an error/partial envelope.
Do not automatically repeat append/create, roll back a saved card or delete source.
Inspect first, then complete checked files' commit, strict source adoption, factual
recovery note instead of invented transition, or explicit touch as appropriate.

Shared CLI/MCP managed home writes use one inherited-descriptor Linux advisory lock,
exact byte-preimage declarations, a bounded pending marker and one observed non-force
push. They require an already published private main/origin setup; bare workspace
composition and explicit maintenance commands remain uncoordinated. Unknown outcomes
block only participating home writes; status/reconcile never replay mutations. See
[HOME-WRITER](HOME-WRITER.md) for prerequisites, partial fields and bypasses.

For home/context persistence, filesystem guards reject traversal,
symlink/hardlink aliases and implicit overwrite. Low-level local context commits
preserve unrelated staged changes and avoid hooks/fsmonitor/signing/network.
The managed route instead refuses unrelated staged state at admission and separately
contacts the configured remote for observation/publication. Private context attributes
prevent EOL/encoding/filter transforms. Separate [workspace helpers](M1-CLI.md#explicit-git-workspace-helpers)
honor ordinary non-executable text/encoding attributes, and explicit publish uses the
selected remote transport. Source/inbox are immutable;
journal/errors append-only. Committed journal prefixes are checked before extracting
published artifact references. New versions get new paths. Mutable context can be
restored from a full Git revision by making a new commit, not rewriting history.

## 7. Backup and restore

SQLite backup API with cooperating-writer lock, clean context Git bundle and checksum
manifest after reference/pair checks. DB-only backup needs no home. Restore only into
absent DB/home, with checksum/schema/integrity/FK and source/artifact checks; no overwrite.
Git is not whole-system backup and cannot restore unsaved data. Scheduling, retention,
network sync and personal initialization require explicit action. See [M1-CLI](M1-CLI.md).

## 8. Verification and future execution

[TESTING](TESTING.md) is the sole test-policy source: fast/boundary, mandatory verify,
systemd/cgroup v2 + bubblewrap, no personal data/network. Do not raise limits for green
or run an unbounded fallback. Admission is not proof of sandbox security.
Rules are checked through APIs and real SQLite/FS/Git/CLI/MCP boundaries; build-state
rejects stale dist. Product suites do not run LLMs or nested suites. Ordinary hosted CI
is not the independent trusted gate ([M1-CI](M1-CI.md)); local file/DB owners and GitHub
admins remain trusted. Evidence does not claim final production acceptance.

A future unit defines role, interface, restrictions and acceptance. Flow composes units;
runtime validates inputs/results and persists state. Root/org/project coordination
and request workers should receive relevant working context. No
mandatory LLM process per level, automatic status-triggered execution, process-tree
ownership guarantee or universal human-only acceptance is implemented or assumed.
