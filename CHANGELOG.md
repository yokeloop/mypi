# Changelog

All notable changes to mypi are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); released versions
match the GitHub releases.

## [Unreleased]

### Added

- Live delivery to Pi: the Pi extension holds `$XDG_RUNTIME_DIR/mypi/<key>.sock`
  (0600) from `session_start` to `session_shutdown` and registers its path.
  `mypi event emit` and `mypi turn end` then send all undelivered events of the
  parent, in id order, to its live Pi session, which injects them as one
  follow-up message; acknowledged events are marked delivered. Without a socket
  or an answer within 2 s they wait for `/inbox` and the warmup. A displaced
  session silently stops receiving events.
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

- `mypi event emit` and `mypi turn end` print `{"event":N,"delivered":[ids]}`
  instead of `{"event":N}`.
- A project warmup marks the events it shows in full delivered; MCP `warmup`
  is no longer read-only.
- The pipeline board skill `/queue` is renamed `/board`.
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
- MCP exposes 13 agent tools instead of 35: `warmup`, `task_list`, `task_show`,
  `task_create`, `task_update`, `memory`, `note`, `journal`, `context_read`,
  `context_write`, `projects`, `sessions`, `open_session`. `task_update` replaces `task_status`,
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
