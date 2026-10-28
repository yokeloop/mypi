# Changelog

All notable changes to mypi are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); released versions
match the GitHub releases.

## [Unreleased]

### Added

- `mypi home migrate-tasks [--dry-run]`: moves task folders from `requests/`
  to `tasks/` in home with one Git commit and rewrites the stored paths; shows
  a preview, refuses a dirty home, and is a no-op when nothing is left to move.
- `tasks.worktree_path` column (NULL until a later release fills it).
- Role texts `integrations/prompts/global.md`, `project.md`, `task.md` and
  `howto.md`, served by warmup.
- Task cards (`task show`, `task list`, MCP) include `worktreePath`
  (read-only; null until a later release records worktrees).

### Changed

- Tasks replace requests everywhere: CLI `mypi task …` (was `mypi request …`),
  MCP tools `task_*` (was `request_*`; 35 tools), journal scope `task:KEY` and
  event `task_created` (`journal_read` filter `eventType`), partial result
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

### Removed

- Creating a task without a project (`project: null`, standalone `REQ`).
  Existing `REQ-N` records remain readable under their keys.
- Work chats: the `work-chats` module, the `mypi work-chat *` CLI commands,
  the `/work-chat` slash command of the Pi extension, the seven `work_chat_*`
  MCP tools (35 tools remain) and `docs/WORK-CHATS.md`. Pi history files and
  `home/pi/work-chats.json` are left untouched.
- The JSON warmup (`memory`, `projects`, `inbox`, `history`, `work`,
  `glossary`) and organization scopes for warmup.
- Pi autoload of scoped context is paused until the Pi integration adopts
  the text warmup; sessions report "mypi context unavailable".
