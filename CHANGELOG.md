# Changelog

All notable changes to mypi are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); released versions
match the GitHub releases.

## [Unreleased]

### Added

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

### Changed

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
- MCP exposes 11 agent tools instead of 35: `warmup`, `task_list`, `task_show`,
  `task_create`, `task_update`, `memory`, `note`, `journal`, `context_read`,
  `context_write`, `projects`. `task_update` replaces `task_status`,
  `task_title`, `task_progress` and `task_touch` (one call with a reason; parts
  run status → title → progress, a later failure returns `partial`); `memory`
  (action show|add|remove) replaces `memory_*`; `note` (kind
  note|journal|error|capture) replaces `note_add`, `journal_add`, `error_add`
  and `capture`; `journal` replaces `journal_read`; `context_write` replaces
  `context_commit`; `projects` (action list|add|update|resolve) replaces
  `project_*`. Application commands and the CLI are unchanged. Warmup's
  truncation marker and its "no clone" error name the new calls; the Pi
  extension exposes `projects` and `warmup` directly.

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
