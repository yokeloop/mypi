---
name: queue
description: Show where the mypi v2 tasks stand — status, plan URL, PR, worktree, open derive threads — in one table, with the next sensible command per task. Read-only. Triggered by "/queue".
---

# /queue — the board

Read-only. `BIN=scripts/pipeline` (relative to the engine root, the main chat's working directory).

1. `$BIN/mp-task v2` — the v2 tasks with statuses.
2. For each task not `new`: the task folder (`$BIN/mp-task dir`) gives
   `derive.json` (plan URL), `pr.md` (PR), `progress.md` (stage). For `planning`
   tasks run `catch_up` on the plan's `short_id` with `comments: open` and count
   the threads.
3. `git -C projects/yokeloop/mypi worktree list` —
   which `mypi--MP-*` worktrees exist.
4. Print one table: key, title, status, plan (URL or —), open threads, PR, next
   command (`/plan` for `new`; `/do` for `planning` with no open threads;
   `/plan` again when threads are open; «ручная проверка → /ship» for
   `review`; — for `merged`/`done`; the reason for `blocked`). Batches from
   `home/projects/yokeloop/mypi/batches/*.md` get a line each.

No status changes, no commits.
