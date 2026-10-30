---
name: board
description: Show where the mypi v2 tasks stand — status, plan URL, PR, worktree, open derive threads — in one table, with the next sensible command per task. Read-only. Triggered by "/board".
---

# /board — the board

Read-only. `BIN=scripts/pipeline` (relative to the engine root, every session's working directory).

0. **Session scope.** `$BIN/mp-task scope`, then apply the «Session scope» rule of
   `docs/PIPELINE.md`: `global` or `MP` — continue; any other key, `MP-N`
   included, or a non-zero exit — print `The board belongs to MP; this session's scope is <key>. Open the main chat with /open global or /open MP.`
   and stop, without `$BIN/mp-task v2`, `catch_up` or `git worktree list`.
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
