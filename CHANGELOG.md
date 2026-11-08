# Changelog

All notable changes to mypi are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); released versions
match the GitHub releases.

## [Unreleased]

Upgrading: schema 15, run `mypi db init` once after the update (back up the database
first); reload or restart Claude Code and Pi sessions so the new roles and the Pi
extension take effect. Run `mypi archive import` once to fill the conversation archive
from existing transcripts. MEMORY.md is no longer read; move facts into INDEX.md (MP-106) before updating.

### Added

- Knowledge entries (MP-104): every level's entry is `INDEX.md` in its home folder (`home/INDEX.md`, `home/projects/<org>/INDEX.md`, `home/projects/<org>/<project>/INDEX.md`; a task's entry is its card). The warmup shows the entries of the scope's level and all its parents under «Knowledge entries», a missing one as an invitation line naming its path and owner chat; over the limit the farthest entry is clipped first with a `context_read` line. «Последние доклады» no longer vanish silently: a line counts the reports left out and names the call that reads them. The project-management skill drafts the project's (and a new organization's) entry at registration and writes it after the user agrees.
- Reading events (MP-104): MCP `events` and CLI `mypi event list` read events read-only, newest first, with the filters of `GET /v1/events` (`to`, `from`, `kind`, `delivered`, `q`, `before`, `limit`); they never mark events delivered.
- Conversation archive (MP-85: MP-95–MP-102): a local SQLite archive `archive.sqlite3` beside the state DB (0600, own `user_version`, not part of the state schema) with the human turns and final answers of Claude and Pi sessions — readers for both transcript formats skip reasoning, tool calls and subagents and keep parent messages and mypi frames with their origin; each session is bound to a scope key through `sessions`, else its registered name. `mypi archive import` fills it from the engine root's transcript folders of both agents (or `--dir … --agent …`) from each file's saved offset, `mypi archive status` counts it; live capture runs `mypi archive capture` from Claude's Stop and SessionEnd hooks and from the Pi extension after each settled turn (`agent_settled`). MCP `archive_search` (FTS5, ranked snippets, scope, agent and date filters; Pi exposes it directly) and `archive_show` (around a hit or a session page) read it, also as CLI `mypi archive search|show`, and the howto map points agents to them, the journal first for past decisions. `mypi archive forget --session|--key|--before` deletes messages on the user's explicit request and keeps the session offsets so the text does not come back. The archive is kept indefinitely, is never part of backup, `--publish` or restore, and needs no `db init`: the first import or capture creates it.
- Skill `retro` (MP-102): a retrospective of a project, organization or task for a period — the journal as the skeleton, `archive_search` without a query to list the period's sessions, `archive_show` page by page, one session per clean-context subagent where the agent has subagents, topic searches for the gaps, and one context note with the sources; the archive is never changed. Claude Code reaches it through `.claude/skills/retro`, Pi through `.pi/skills`.
- Journal facts of the engine (MP-88): five event types — `worktree_created` (task scope, `task worktree` when it creates the worktree: `worktree <path>, branch <branch>, base <integration>`), `session_opened` (task, project or organization scope, `/open` when it starts or resumes a session: `started <agent>` / `resumed <agent>`, with `, worktree <path>` for a task; nothing on focus), `message_sent` (the recipient's scope, every accepted parent message: `message <id> from <parent>: <first line, up to 120 characters>`), `title_changed` (task scope, a task rename; the text `Title: "a" → "b". <reason>` is unchanged) and `clone_prepared` (project scope, a checkout cloned, initialized or adopted by `/open`: the same text as its `notes` line). The list lives once in `EVENT_TYPES`; `journal read --type`, MCP `journal` and `GET /v1/journal?type=` accept the new types. A type other than note is accepted only in the scopes of its fact. `mypi project remove` now refuses a project that was opened (`session_opened`) or cloned by `/open` (`clone_prepared`), because those entries are project-scope journal rows and journal rows block removal.
- Journal in the warmup (MP-91): a project warmup ends its tail with «Журнал» — the number of journal entries of the project and all its tasks with the local date of the newest one («Записей в журнале проекта нет.» when none) — and a task warmup with the task's last five entries in the journal line format (date, time, type, text up to 300 characters, artifacts; «Записей в журнале задачи нет.» when none); both name the `journal` call with `limit` 20 and its CLI form. Over the budget a task warmup drops the shown entries from the oldest before clipping knowledge entries, and after the knowledge entries clips the end of its card with a pointer to `context_read`, so a long card no longer pushes the Claude hook past 10,000 characters; the project line, the task heading with its count and the loader are never cut. The counts come from one SQL statement of the journal store (`stats`, `last`), not from a scope-resolving read, so the Claude hook stays fast.
- Organization scope and chat (MP-78): the bare organization slug (`tb-ff`) is a session key. `/open tb-ff` (MCP `open_session`, CLI `mypi open`) opens, focuses or resumes the organization chat in the Herdr tab `org-tb-ff` of the workspace `tb-ff`, in the engine root, with no clone or worktree; `global`, `all`, an unknown organization and an organization without registered projects are refused. The organization chat leads the tasks of all registered projects of its organization: it opens their task chats and sends them parent messages directly. Its warmup (role `org`) carries the global and organization knowledge entries, one line per project and the events addressed to it; its start message lists each project's open tasks by status. Pi completes `/open` with the organization's projects and their open tasks; the pipeline skills accept the organization scope (`mp-task scope` adds `org` and `codes`).
- Skill `/epic` and role `plan-challenger` (MP-107: MP-109): `/epic <KEY>` reads the epic's step from its status and folder (`docs/PIPELINE.md`, «Epics») and leads research, one review round, publication, an independent check by the read-only role `plan-challenger`, one question per finding with its decision row, version 2 and the subtasks created with `--parent`; the answer «Завести и запустить /flow» runs `/flow <name> <KEY>`. Claude Code only, through `.claude/skills/epic` and `.claude/agents`.

### Changed

- Core mypi instruction (MP-105): «How to work in mypi» is cut from 5,883 to about 2,000 characters — a map of where to look (including `events` for delivered reports), the write rules and a paragraph on keeping knowledge by progressive disclosure; what the MCP tool descriptions already say is gone, event delivery is a link to `docs/agents/sessions.md`. The roles are about 1,200 characters each; clone administration moved from the main chat's role to the project-management skill. The `/open` start message no longer repeats the warmup: a task or project gets its key and title and the next-step line, an organization its projects' open tasks without the event count. `docs/PLAN-FORMAT.md` asks a plan to name documentation and level-map changes, and the task reviewer checks the level's entry in home.
- AGENTS.md as a map (MP-103): the core every session loads is cut from 28,156 to about 7,800 characters — scope, instruction ownership, communication, home, the common project workflow and the installed-engine boundary — and ends with a map of where to read more. Engine development, installation and updates, Claude Code and Pi integration, sessions and event delivery, and the HTTP API moved verbatim to `docs/agents/*.md`; project registration and removal details to the project-management skill. A fast test checks the core size and that every link, anchor and repository path in `AGENTS.md` and `docs/` exists; the test sandbox and CI now copy `AGENTS.md`, `docs/` and the other files they name.
- Schema 15 (MP-88): `knowledge_journal` is rebuilt with the enlarged event type check and keeps its rows; `mypi db init` is required.
- Repeated task status (MP-89): `task status <KEY> <same status> --reason <text>` (MCP `task_update`, `PATCH /v1/tasks/{KEY}`) leaves a `note` `<status> (unchanged). <reason>` in the task journal instead of writing nothing; the card, its `updatedAt` and the milestone rule are unchanged, a repeated title still writes nothing, an empty reason is still refused. The plan skill records a rework reason in that status call, not in `progress`.
- Milestone text (MP-93): the `milestone` event of a status change carries the exact text of the task's `status_changed` journal entry, `<before> → <after>. <reason>` (was `<before> → <after>: <reason>`); the event frame in `/inbox`, the warmup and the start message, its recipient and the milestone statuses are unchanged.
- Journal types in the web UI and the TUI (MP-92): the journal `type` filter of both offers all eight event types of `EVENT_TYPES` in the engine's order (was note, task_created, status_changed), and the new types get their own colours — web badges `title_changed` yellow, `worktree_created` teal, `session_opened` indigo, `message_sent` violet, `clone_prepared` grape; TUI rows `worktree_created` green, `title_changed` yellow, `session_opened`, `message_sent` and `clone_prepared` magenta. An unknown type still renders in the neutral colour; the web list is checked against `EVENT_TYPES` by a fast test.
- Event routing (MP-78): a task has two parents, its project chat and its organization chat. `turn_end` and `waiting` go to the sender of the parent message that started the turn (`mypi event emit --to`), else to the project; a milestone goes to the parent that last sent the task a message, else to the project, unless that recipient makes the change. Refusals of a non-parent sender name both parents.
- Sessions tree (MP-78): `mypi sessions` (MCP `sessions`) shows global → org → project → task.
- Schema 14 (MP-78): `sessions` gains the scope `org` and the column `org_id`; `mypi db init` is required. `mypi org remove` refuses while an organization session or an event with its slug exists.

### Removed

- Memory (MP-104): `MEMORY.md` files, the MCP tool and CLI command `memory` and the warmup's memory zones and fact hiding are removed; durable facts live on a level's entry or in a branch it links.

## [0.11.0] - 2026-11-04

Upgrading from v0.10.0: `git pull --ff-only`, `mise install` (now also installs the
pinned Rust 1.99.1 for the TUI), install the locked dependencies (the root and the
`web/` workspace package) and build; no migration (schema 12); reload or restart
Claude Code and Pi sessions (Pi `/reload`, Claude `/mcp` reconnect) so the new main
chat role takes effect. For the terminal UI also run `pnpm tui:fetch` and
`pnpm tui:build`. `mypi serve` (HTTP API, web UI, remote MCP) is optional and
starts only when you run it; create a token with `mypi token create` first.

### Added

- HTTP API (MP-71): `mypi serve` runs a foreground REST/JSON server under /v1 on 127.0.0.1:8737 (another address only with --listen, e.g. a Tailscale IP; no TLS in process) with bearer tokens from `mypi token create|list|revoke` kept hashed in $XDG_CONFIG_HOME/mypi/api-tokens.json. It reads projects, tasks, events (without marking them delivered) and the journal with filters, search and cursor pages, sessions and context files; it writes task create/update, journal notes and parent messages from the token's sender. /v1/info carries changeId, which also streams over SSE /v1/changes. A documented systemd user unit is an example, not installed. Restart the server after an engine update or migration.
- Web UI (MP-72): `mypi serve` also serves a read-only browser interface at / (projects, tasks, events and the journal with filters, search, cursor "Load more", live refresh over /v1/changes and a Refresh button; phone-width layout). Sign in by pasting an API token: POST /v1/session sets an HttpOnly, SameSite=Strict cookie (Secure behind an HTTPS proxy) that authenticates reads only; DELETE /v1/session signs out, and revoking the token ends the session. Built from the web/ pnpm workspace package (React, Mantine, Vite) into dist/ui by pnpm build; restart the server after a rebuild.
- Terminal UI (MP-70): tui/bin/mypi-tui (Rust, ratatui) browses projects, tasks, events and the journal through the HTTP API with filters, search, cursor pages, live refresh over /v1/changes (r to reload) and keyboard and mouse control; it adapts from phone-width ssh terminals (one column below 60) to wide split views, tolerates unknown fields and checks apiVersion. On project and task rows "o" opens or focuses the session tab through mypi open when it runs inside Herdr. It runs in any terminal or as the Herdr plugin in tui/ (herdr plugin link, a user step). Rust 1.99.1 is pinned in mise.toml; pnpm tui:fetch and pnpm tui:build build it, and pnpm verify and CI run its cargo checks offline in a bounded unit. Upgrade: mise install, pnpm tui:fetch, then pnpm tui:build.
- Remote MCP (MP-73): `mypi serve` also answers MCP over Streamable HTTP at /mcp (stateless, JSON responses) with the same bearer tokens, for agents on other machines. Read tokens get task_list, task_show, journal, context_read and projects list/flow; write tokens also get task_create, task_update without artifacts, note kind journal and send_message from the token's sender. Text inputs are {text} only; sessions, inbox, warmup, memory, open_session and maintenance stay local. The server now runs as its own entry, dist/src/http/main.js, which `mypi serve` starts as a child process, so other CLI commands no longer load it.

### Changed

- The full test profile's working budget is 55 s instead of 50 s (MP-71): with the HTTP API boundary test the profile took 49.4–50.4 s locally with fail 0. The test unit (scripts/check.sh) and the CI build unit mypi-ci-build (scripts/ci.sh) both get RuntimeMaxSec 58 s and TimeoutStopSec 2 s, still 60 s in total, so the external 60 s deadline and all other limits stay unchanged; speeding up boundary is a separate task.
- The main chat's role (MP-76) administers project setup on the user's request:
  clones (a partial clone when a full one fails and the user agrees), remotes and
  forks, branches and worktrees, registrations, and whatever keeps a project or
  task tab from starting. Product work stays in project and task chats;
  destructive actions and external writes need the user's current request and an
  inspection first.

## [0.10.0] - 2026-11-03

Upgrading from v0.9.0: `git pull --ff-only`, install the locked dependencies and
build; no migration (schema 12); reload or restart Claude Code and Pi sessions
(Pi `/reload`, Claude `/mcp` reconnect) so `/open` progress, cancellation and key
suggestions take effect.

### Added

- Pi's /open suggests project and open task keys while its arguments are typed
  (MP-74): only the session's project in a project or task chat, everything in the
  main chat; the list comes from the CLI and is reused for 15 s.

### Changed

- README «Claude Code» (MP-66) describes what tabs opened by `/open` load, how
  Herdr restores sessions after a restart or reboot (the scope survives through
  the native id; the permission mode and `/open`'s `crossSessionInbound` argument
  do not, so live delivery to restored Claude sessions needs `accept` in user
  settings) and how running Claude and Pi sessions pick up an engine update.
- The pipeline skill `/batch` is replaced by `/flow <name> <KEY> [<KEY>…]`
  (MP-67). One key is the ordinary case. The lead announces the order (dependencies
  and file overlaps) before the start; tasks go one at a time through plan → do →
  review → checks, with live acceptance where the plan names one. Plan forks, review
  findings beyond the plan, red checks or CI, exceeded budgets and scope changes are
  questions to the engineer, and the run waits for the answer instead of deciding or
  setting `blocked`. The result is one branch `flow/<name>` and one PR to the
  project's PR target, merged by `/ship flow/<name>`; scores live in `<project
  home>/flows/`, earlier `batches/` scores and `batch/*` branches stay as history.
  `/plan --auto` is removed. The installed engine keeps `/batch` until it is
  updated.
- `/flow` runs the live acceptance a plan names without asking the engineer first
  (MP-77); an exceeded stand budget or a failure that needs a decision is still a
  question.
- `/open` (MP-75) clones a project without a clone asynchronously with live
  progress — the Pi footer status with "Esc cancels", MCP progress notifications
  when the call has a progressToken, CLI stderr lines prefixed "mypi: " — and
  without the 100 s limit; a clone stops only after 5 minutes without progress.
  Git clones into a temporary sibling directory that is renamed into place after
  verification, so a half clone is never adopted. Esc in Pi, cancelling the MCP
  call or SIGINT/SIGTERM of the CLI stops git and removes the partial clone;
  nothing is registered and the next `/open` prepares it again. Pi's `/open` no
  longer has a 120 s limit.

## [0.9.0] - 2026-11-02

Upgrading from v0.8.0: `git pull --ff-only`, install the locked dependencies and
build; back up the database, then run `mypi db init` once (schema 9 → 12,
migrations 010-012; until then commands that open the database ask for it);
reload or restart Claude Code and Pi sessions. Details are in the Upgrade entries
below.

### Added

- CLI commands `project remove <org/project> --expected-code <CODE>` and
  `org remove <org>` (MP-48) undo a mistaken registration: they delete only an
  unreferenced project or an organization without projects and otherwise refuse,
  listing each kind of reference with its count. `home/` folders stay and are
  reported as `homeFolder`. Neither command is available over MCP.
- `/open` (MP-52) sends a session it newly starts one start message in the frame
  `[mypi: стартовое сообщение для <key>. …]` through the same socket as events:
  a project's open tasks by status and the number of undelivered events, or a
  task's status, worktree and last journal entries with their artifacts. It is
  state, not an instruction, and creates no events; when it cannot be delivered,
  `/open` still succeeds with `start message not delivered: <reason>` in `notes`.
- Parent-to-child channel (MP-55): a direct parent (project chat → its task,
  main chat → a project) sends its child an instruction with MCP `send_message`,
  CLI `mypi send <key> (text | --file source)` or `/open <key> --message <text>`
  (MCP `open_session.message`). It is stored as an `events` row of kind
  `message`, arrives as a new turn in the parent-message frame through the same
  channels as events, and a closed child gets it once at the next `/open`, in one
  message with the start text. Its turn is parent-started, so the answer comes
  back as `turn_end`. The warmup does not show messages. An instruction never
  stands in for the engineer's word for /do, /ship, merge, release, migration or
  an engine update.
- `project flow <CODE|org/project>` and `projects` action `flow` (MP-58) return
  the project's branch flow from `home/projects/<org>/<project>/flow.json`
  (`integration`, `taskBranch`, `prTarget`, `mergeMethod`, `release`) with
  defaults and `source` `file|default`; an invalid file is refused with the file
  and the field. With a flow.json the project warmup shows one flow line after
  `Base clone:` and a task warmup the expected task branch; without it, nothing.
- Project `repository` (MP-61): `project add --repository <git-url|local>`,
  `project update` with `--expected-repository`/`--expected-repository-unset`
  and MCP `projects` `repository`/`expectedRepository` record a project's Git
  remote URL or `local`; `list` and `resolve` return it. `/open` of a project
  without a clone clones it from that URL (or runs `git init` for `local`) into
  `projects/<org>/<project>`, or adopts an existing clone there, verifies and
  registers it, and says `clone prepared: …` in `notes`; without a repository it
  refuses before anything opens. Task worktrees of a `local` project come from
  its local branch without `origin`.

### Changed

- The warmup's «How to work in mypi» (`integrations/prompts/howto.md`, MP-62)
  states how to register tasks: only on the user's explicit request, one task per
  independent problem, merged or split only with the user's agreement, with a
  question when their number or boundaries are unclear; the title and card keep
  the user's wording and scope. Other lines of the file are tightened without
  changing their meaning, so the warmup stays within the 9500-character budget.
- `task worktree` (MP-58) applies the project's flow: it fast-forwards the flow's
  integration branch and names the task branch by its template, refuses an invalid
  flow before creating or recording anything, adds `createdBranch` to its result
  and returns a recorded worktree with its actual branch after the flow changed.
  `scripts/pipeline/mp-worktree` delegates its single mode to it; the `/do`,
  `/batch`, `/ship` and `/plan` skills take the base, PR target and merge method
  from `mp-task flow` instead of `main`.
- `/open` (MP-57) opens the sessions of a project and of its tasks as tabs in
  that project's Herdr workspace: labelled `org/project`, found by its label,
  created when missing, its first tab taken by the first session opened. A task
  opened without its project's workspace creates it without the project session.
  `HERDR_WORKSPACE_ID` and the `mypi` workspace are no longer used. Tabs already
  open in `mypi` are not moved: a live session is still focused by its agent
  name, and after its agent quits the next `/open` continues it in the project's
  workspace while the old shell tab stays.
- `inbox` (MP-55) of a task key returns its parent's messages and marks them;
  `inbox all` skips messages. Upgrading: schema 9 → 10, migration 010: after
  updating run `mypi db init` once (back up the database first); until then
  commands that open the database ask for it.
- The full test profile has a working budget of 40 s instead of 30 s (MP-63)
  because CI runner speed varies. The Pi and Claude socket reply deadline is a
  parameter of `piEventSocket` and `claudeInboxSocket` with the same production
  value of 2000 ms; the silent-socket boundary test uses 200 ms. The other
  limits are unchanged ([docs/TESTING.md](docs/TESTING.md) §6).
- Journal artifacts are references to a file version (MP-53): `task progress`
  commits the named files in home (without push) and records each as
  `{path, commit}`. Artifact files and a task's `source.md` stay editable; an
  entry reads the version it registered with `mypi context read <path> --revision
  <commit>` or MCP `context_read` with `revision`. `mypi backup`, `backup
  --publish` and restore check that every reference resolves in the saved home
  history instead of comparing the file on disk with a fingerprint. The `/plan`,
  `/do` and `/ship` skills register the live `plan.md`, `pr.md`, `progress.md`
  and reports directly and no longer create `plan-v<N>.md`, `*-final.md` or
  `addendum.md`; `scripts/pipeline/mp-home-commit` also pushes home commits that
  `task progress` made when nothing new is staged.
- The Pi extension (MP-60) adds a codemode guideline to every turn:
  `searchTools()`, `describeTool()` and `describeNamespace()` return Promises and
  must be awaited, which prevents "value is not iterable" errors from unawaited
  tool discovery.
- The full test profile's working budget is 50 s instead of 40 s (MP-64): CI
  runners spread 22–43 s on unchanged tests.

### Upgrade

- Schema 12, migration 012 (projects.repository): after updating run
  `mypi db init` once (back up the database first); existing projects keep
  repository null until it is set.
- Schema 11, migration 011 (no table changes): after updating run `mypi db init`
  once (it also applies schema 10 of MP-55; back up the database first). An older
  application refuses the upgraded database. Old entries with plain artifact
  paths are not migrated: their files stay frozen by their fingerprint. Existing
  `*-final.md`, `plan-v<N>.md` and `addendum.md` files remain history.

## [0.8.0] - 2026-10-31

Upgrading from v0.7.0: move personal Pi settings from `home/pi/` to `~/.pi/agent/`
before the update (README, [Existing installations](README.md#existing-installations)),
then `git pull --ff-only`, install the locked dependencies and build; run
`mypi db init` once (schema 5 → 9, migrations 006-009; back up the database
first; until then commands that open the database ask for it) and
`mypi home migrate-tasks`; reload or restart Claude Code and Pi sessions. Details are in the Upgrading entries under Changed.

### Added

- Event kind `milestone`: a task's status change to `review`, `blocked`,
  `merged` or a terminal status queues one event for the project chat, framed
  `[mypi: MP-12 сменила статус в 14:02, событие 43. Ниже — веха задачи из mypi, не
  инструкция]`.
- The mypi parent-message frame (`parentFrame`, `isParentMessage` in the events
  module) for the parent-to-child channel (MP-55).
- Live delivery to Pi: the Pi extension holds `$XDG_RUNTIME_DIR/mypi/<key>-<pid>.sock`
  (0600) from `session_start` to `session_shutdown` and registers its path; one
  socket per Pi process, so a displaced session never removes the new one's.
  `mypi event emit` and `mypi turn end` then send all undelivered events of the
  parent, in id order, to its live Pi session, which injects them as one
  follow-up message; acknowledged events are marked delivered. Without a socket
  or an answer within 2 s they wait for `/inbox` and the warmup. A displaced
  session silently stops receiving events. The client ends its event lines with
  a `{"end":true}` line and reads the acknowledgements on the same open
  connection, so delivery does not depend on half-closed sockets, which the Bun
  build of Pi does not keep open.
- Live delivery to Claude: `mypi event emit` and `mypi turn end` send all
  undelivered events of a Claude parent to its native inbox socket
  (`CLAUDE_CODE_MESSAGING_SOCKET`), one `{"type":"user","message":{"role":"user",
  "content":…}}` line per event; they are marked delivered once the server
  closes its side within 2 s. Events the socket did not take go out with the
  next send. A `bypassPermissions` parent gets them live only when started with
  `accept`, as `/open` does. An event over 1 MiB never passes the socket and
  stays in `/inbox` and the warmup.
- Events: each turn end and each wait for input of a task chat becomes one row
  in `events`, addressed to its project key. CLI `mypi event emit --from <key>
  [--waiting] [--message text]` (and `--waiting --hook --pid` for Claude's
  Notification input) and `mypi turn end --pid` (Claude's Stop input); project
  and global keys emit nothing. `inbox` (MCP tool, CLI `mypi inbox
  [CODE|all]`, the Claude skill `/inbox` and the Pi command `/inbox`, which runs
  the `inbox` skill as `/skill:inbox`) returns the undelivered events in their frame
  with the event number and marks them delivered. Claude hooks Stop and
  Notification (`permission_prompt`, `idle_prompt`, `elicitation_dialog`);
  the Pi extension emits on `agent_settled` and `ui_prompt_start`. A project
  warmup shows «Новые события» and «Последние доклады» (the last delivered
  event of each open task), cut first when over budget.
- `/open`: MCP tool `open_session`, CLI `mypi open <key...> [--agent claude|pi]
  [--permission-mode mode]`, the Claude skill `/open` and the Pi command `/open`.
  For each key (project code, CODE-N, org/project, org/project#N) it focuses the
  live session (`herdr agent focus`) or opens a no-focus Herdr tab in the engine
  root with `MYPI_SCOPE` and starts the agent: a new session, or the saved one
  resumed with its own agent. A task key creates its worktree first. Refuses
  without Herdr, for projects without a clone and for global and REQ keys, with
  no tab and no rows; writes no session rows itself.
- docs/v2/facts.md: stage-0 facts for mypi v2 (Claude Code 2.1.283, Pi 1.0.4,
  Herdr 0.9.5) with reproduction commands and fallbacks; the v2 glossary and
  ADRs 0001-0002 in .yoke/.
- `mypi home migrate-tasks [--dry-run]`: moves task folders from `requests/`
  to `tasks/` in home with one Git commit and rewrites the stored paths; shows
  a preview, refuses a dirty home, and is a no-op when nothing is left to move.
- `tasks.worktree_path` column (NULL until a later release fills it).
- Role texts `integrations/prompts/global.md`, `project.md`, `task.md` and
  `howto.md`, served by warmup.
- Task cards (`task show`, `task list`, MCP) include `worktreePath`
  (read-only; null until a later release records worktrees).
- `mypi task worktree <KEY>`: fetches `origin` in the project's registered base
  clone, fast-forwards its main branch without switching the clone's branch,
  creates `task/<KEY>-<slug>` with its worktree `<clone>--<KEY>-<slug>` and
  records the path in the card; a repeated call returns the recorded worktree.
  Refuses tasks without a project, projects without a clone, a main branch that
  cannot be updated, a branch checked out in another worktree and a foreign
  directory at the path. CLI only, no MCP tool.
- Tracked Pi configuration: `.pi/extensions/mypi.ts` registers the `mypi` MCP
  server with the session id in `PI_SESSION_ID` at every Pi session start and
  loads `mypi warmup` (scope `MYPI_SCOPE`, else `global`) into the `mypi_context`
  system-prompt section of every turn; `.pi/skills` points to the built-in skills.
  Checked manually with Pi 1.0.4.
- `home/settings.json` with `defaultAgent` (`claude`), created by bootstrap when
  absent and otherwise kept byte for byte.
- Claude Code adapter: tracked `.mcp.json` (the `mypi` MCP server via `node
  dist/src/mcp/main.js`) and `.claude/settings.json` (allow list of exactly the
  mypi MCP tools; SessionStart hook on startup, resume, clear and compact that
  prints `mypi warmup --max-chars 9500`); shared skills symlinked into
  `.claude/skills/`; `.claude/settings.local.json` is ignored. The tracked
  settings do not set `crossSessionInbound`: project settings can only tighten it.
- `mypi warmup --max-chars n` (1–21845): caps the warmup at n characters with
  the same memory cut as the 64 KiB limit; the marker names the limit.
- Session registry: schema 8 adds the `sessions` table (key → agent and native
  id, kept for continuation) and the `events` table (filled later). Live records
  in `$XDG_RUNTIME_DIR/mypi/sessions/<key>.json` (owner-only; pid and start,
  native id, name, socket, start permission mode); reads skip dead records and
  the next registration, unregistration or forget removes them. A newer live session under a key becomes canonical; the older record
  moves to `<key>~<pid>.json`.
- CLI `session register|unregister|forget` and `sessions`; MCP tool `sessions`
  (read-only tree global → project → task with live/closed).
- Claude Code's SessionStart hook registers the session on every source,
  including fork, before the warmup; the Pi extension registers at session start,
  passes the key to the warmup and unregisters on quit. A hand fork without
  `MYPI_SCOPE` is not registered. Checked manually with Claude Code 2.1.283 and
  Pi 1.0.4.

### Changed

- Answer to whoever asked: Claude's Stop hook and the Pi extension create a
  `turn_end` event only in a turn a parent message started (Claude: the
  transcript entry that opened the turn has `turnOrigin` `peer` and the mypi
  parent-message frame; Pi: a batch with that frame arrived through its socket).
  A turn a person started creates nothing.
- Milestones: a status change to `review`, `blocked`, `merged` or a terminal
  status creates a `milestone` event unless the project chat itself makes it;
  milestones wait for `/inbox` and the warmup and are never sent live.
  «Последние доклады» show only the last delivered `turn_end`.
- Waiting for input: `idle_prompt` never creates an event and left the
  Notification matcher; `permission_prompt`, `elicitation_dialog` and Pi's
  `ui_prompt_start` create a `waiting` event only in a turn a parent message
  started.
- Until the parent-to-child channel (MP-55) and the /open start message (MP-52)
  land, no hook or extension sends the parent-message frame, so Claude hooks and
  the Pi extension create no turn_end or waiting events at all; only milestones
  and manual mypi event emit --from remain.
- `mypi event emit` and `mypi turn end` print `{"event":N,"delivered":[ids]}`
  instead of `{"event":N}`.
- A project warmup marks the events it shows in full delivered; MCP `warmup`
  is no longer read-only.
- The pipeline board skill `/queue` is renamed `/board`.
- The pipeline skills /plan, /do, /batch and /ship run the tasks of any registered
  project: the project, its clone, home folder and repository come from the task
  key; checks come from the project's instructions or the approved plan. The
  pipeline scripts mp-task list and mp-task v2 are removed.
- Tasks replace requests everywhere: CLI `mypi task …` (was `mypi request …`),
  MCP tools `task_*` (was `request_*`), journal scope `task:KEY` and
  event `task_created` (`journal` filter `eventType`), partial result
  field `taskId` (was `requestId`). Legacy JSONL import maps the old literals.
- SQLite schema 6 → 7 renames `requests` → `tasks` and `request_statuses` →
  `task_statuses` with their index and triggers, rebuilds `knowledge_journal`
  with the literals `task`/`task_created` and adds `tasks.worktree_path`
  (migration 007). Stored paths are not changed; existing `requests/` folders
  stay readable until `mypi home migrate-tasks`. The upgrade requires explicit
  migration (`mypi db init`) under explicit authorization. Back up the
  database first.
- SQLite schema 5 → 6 drops the `work_chats` table (migration 006).
  The upgrade requires explicit migration (`mypi db init`) under explicit
  authorization. Back up the database first.
- `mypi warmup [-s global|CODE|CODE-N]` and the MCP `warmup` tool (`scope`
  is now an optional key string) print Markdown: personal instructions,
  role, how to work in mypi, zone memory, then the project list, open tasks
  or the task card with its worktree. Scope: `--scope`, else `MYPI_SCOPE`,
  else `global`. Unknown keys, tasks without a project and projects without
  a clone are errors. Output is limited to 64 KiB; the oldest memory facts of
  the farthest zone are hidden first, with a marker naming the full read.
  Headings of embedded files are demoted below the warmup's own sections.
- Task cards' `worktreePath` (`tasks.worktree_path`) is now recorded by
  `mypi task worktree`.
- `pnpm bootstrap` creates only a missing `home/` (Git, `USER-INSTRUCTIONS.md`,
  `settings.json`) and an absent database. It no longer creates `home/pi/`, the
  `.pi -> home/pi` link, the instruction link or Pi package settings.
- Built-in skills moved from `integrations/pi/skills/` to `integrations/skills/`.
- Upgrading: `git pull` replaces the local `.pi -> home/pi` link with the tracked
  `.pi/` directory, and Pi no longer loads `home/pi/` (settings, MCP servers,
  packages, `APPEND_SYSTEM.md`). Move personal Pi settings to `~/.pi/agent/`
  before updating and remove a stale `integrations/pi` entry from
  `~/.pi/agent/settings.json`.
- MCP exposes 14 agent tools instead of 35: `warmup`, `task_list`, `task_show`,
  `task_create`, `task_update`, `memory`, `note`, `journal`, `context_read`,
  `context_write`, `projects`, `sessions`, `open_session`, `inbox`. `task_update` replaces `task_status`,
  `task_title`, `task_progress` and `task_touch` (one call with a reason; parts
  run status → title → progress, a later failure returns `partial`); `memory`
  (action show|add|remove) replaces `memory_*`; `note` (kind
  note|journal|error|capture) replaces `note_add`, `journal_add`, `error_add`
  and `capture`; `journal` replaces `journal_read`; `context_write` replaces
  `context_commit`; `projects` (action list|add|update|resolve) replaces
  `project_*`. Application commands and the CLI are unchanged. Warmup's
  truncation marker and its "no clone" error name the new calls; the Pi
  extension exposes `projects` and `warmup` directly.
- Warmup without `-s` (CLI, hook, MCP) uses the key registered for the session —
  the row for its native id, else the live record of its process — before
  `MYPI_SCOPE`; a task session continued with `--resume` gets its task warmup.
- Upgrading: schema 8 requires `mypi db init` once after the update; until then
  commands that open the database ask for it.

### Removed

- Creating a task without a project (`project: null`, standalone `REQ`).
  Existing `REQ-N` records remain readable under their keys.
- Work chats: the `work-chats` module, the `mypi work-chat *` CLI commands,
  the `/work-chat` slash command of the Pi extension, the seven `work_chat_*`
  MCP tools and `docs/WORK-CHATS.md`. Pi history files and
  `home/pi/work-chats.json` are left untouched.
- The JSON warmup (`memory`, `projects`, `inbox`, `history`, `work`,
  `glossary`) and organization scopes for warmup.
- The `integrations/pi` package (manifest, extension, `mcp.example.json`, the
  retired instruction template), the `--mypi-scope` and `--mypi-no-autoload`
  flags (use `MYPI_SCOPE`; `pi -ne` disables extensions) and the
  `mypi-startup-binding` session entry.
- MCP tools `db_init`, `bootstrap`, `backup`, `backup_publish`, `restore`,
  `restore_published`, `journal_import`, `status_list`, `status_add`,
  `status_rename`, `status_terminal`, `status_remove` and `context_restore`:
  these operations are CLI-only (`mypi db init`, `bootstrap`, `backup`,
  `restore`, `journal import`, `status …`, `context restore`).
