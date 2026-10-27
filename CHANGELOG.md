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

### Removed

- Creating a task without a project (`project: null`, standalone `REQ`).
  Existing `REQ-N` records remain readable under their keys.
- Work chats: the `work-chats` module, the `mypi work-chat *` CLI commands,
  the `/work-chat` slash command of the Pi extension, the seven `work_chat_*`
  MCP tools (35 tools remain) and `docs/WORK-CHATS.md`. Pi history files and
  `home/pi/work-chats.json` are left untouched.
