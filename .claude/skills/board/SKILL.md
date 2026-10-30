---
name: board
description: Show where a project's tasks stand — status, plan URL, PR, worktree, open derive threads — in one table, with the next sensible step per task; the project of the session scope, or the typed CODE in the main chat. Read-only. Triggered by "/board [CODE] [all]".
---

# /board — the board

`/board [CODE] [all]` — `CODE` is a project code, `all` also shows terminal tasks.
The word `all` is always the flag, never a `CODE`: `/board all` is the board of the
session's project (or MP in global) with terminal tasks.

Read-only. `BIN=scripts/pipeline` (relative to the engine root, every session's working directory).

0. **Session scope.** `$BIN/mp-task scope`, then apply the «Session scope» rule of
   `docs/PIPELINE.md` by the key:
   - `project` is not `null` (key `P` or `P-N`, any project) — the board of `P`;
     a typed `CODE` must be empty or equal `P`, otherwise print
     `/board <CODE> is not allowed in session scope <key>; this chat shows the board of <P> only. Use /board here or /open global for another project.`
     and stop;
   - key `global` — the board of the typed `CODE`, `MP` by default;
   - a malformed key (`project` is `null` and the key is not `global`) or a
     non-zero exit of `scope` — print
     `The board cannot tell this session's project (scope <key>). Open the main chat with /open global.`
     and stop;
   - `$BIN/mp-task project <P>` with a non-zero exit (unknown code) — print
     `Unknown project code <P>; registered codes: <codes>.`, the codes from
     `mypi project list` (`mise exec -- node dist/src/cli/main.js project list`),
     and stop.

   Nothing runs before a refusal except `mp-task scope`, `mp-task project` and
   `project list`.
1. `$BIN/mp-task board <P>` (with `all` when typed) — JSON lines with `key`,
   `status`, `title`, `dir`, `worktreePath`. The project's `checkoutPath` and
   `home` come from the `mp-task project <P>` output of step 0.
2. For each row, the files in `dir`, only those that exist: `derive.json` (plan
   URL), `pr.md` (PR), `progress.md` (stage). For each task with a `derive.json`
   run `catch_up` on the plan's `short_id` with `comments: open` and count the
   threads.
3. Worktree: the row's `worktreePath` when not `null`; otherwise, when
   `checkoutPath` is not `null`, the entry of `git -C <checkoutPath> worktree list`
   whose path equals `<checkoutPath>--<basename dir>`; otherwise —. Run
   `git worktree list` once per project.
4. Print one table: key, title, status, plan (URL or —), open threads, PR,
   worktree, next. The next column:
   - `P = MP`: `/plan` for `new`; `/do` for `planning` with no open threads;
     `/plan` again when threads are open; «ручная проверка → /ship» for
     `review`; — for `merged`/`done`; the reason for `blocked`; the status
     itself for any other status;
   - `P ≠ MP`: `new` → `plan the task (/open <KEY>)`; `planning` →
     `review the plan; implement in /open <KEY>`; `in_progress` →
     `continue in /open <KEY>`; `review` → `manual check, merge`;
     `merged`/`done` → —; `blocked` → the reason; the status itself for any
     other status.

   The `blocked` reason comes from `$BIN/mp-task show <KEY>` (the card's last
   status reason). Batches: a line for each `<home>/batches/*.md`, only when
   `<home>/batches` exists.

No status changes, no commits. No mypi task worktree, warmup or inbox calls.
