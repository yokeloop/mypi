---
name: do
description: Execute one approved mypi task by its plan — worktree, task-executor teammate implementing step by step, fresh task-reviewer, fix loop, build and verify, push and PR (or merge into a batch branch), status review for the engineer's manual check. Typing it is the plan's approval. Triggered by "/do <KEY> [--base batch/<name>] [--force]".
---

# /do — execute an approved plan

Read ``docs/PIPELINE.md` in the engine root` first. The typed command is the
engineer's approval of the published plan; the plan is the whole scope — never
widen it, never improve adjacent code. `BIN=scripts/pipeline` (relative to the engine root, the main chat's working directory). You are
the lead: you run the stages below and keep score; the code is written by the
teammate.

## Preconditions

1. `$BIN/mp-task show <KEY>`: status `planning` (fresh start) or `in_progress`
   (resume). Anything else → say so and stop.
2. The task folder (`$BIN/mp-task dir <KEY>`) has `plan.md` and `derive.json`.
   `catch_up` on that `short_id` with `comments: open`: an open thread means the
   plan is not approved — say which threads are open, suggest `/plan <KEY>`,
   stop. `--force` skips this check and the fact goes into `progress.md`.
3. Dependencies listed in `source.md` («Связи → Зависит от»): each must be
   `review`, `merged` or `done`, or already merged into the same batch base.
   Otherwise stop and name the missing one; `--force` proceeds and records it.

## Stages

Score is `<task folder>/progress.md`: the plan path on the first line, a checkbox
per stage below, ticked the moment its condition is met. A resumed run starts at
the first unchecked box and never redoes checked work.

1. **Worktree.** `$BIN/mp-worktree <KEY> [--base batch/<name>]` → JSON. `dirty:
   true` → stop and show `git status` of the worktree; nothing is cleaned
   automatically. Status: `$BIN/mp-task status <KEY> in_progress "worktree
   <path>, base <base_ref>"`.

2. **Executor.** Spawn a teammate: `Agent` with `subagent_type: task-executor`,
   `name: <key in lower case>` (`mp-33`), prompt carrying: the key, the plan path,
   the worktree path, the task folder path, the base branch, the path of
   `PIPELINE.md`, the engine checks (`mise exec -- pnpm build`,
   `mise exec -- pnpm verify`, one verify at a time, the retry rule), the rule
   that commits are English imperative without trailers, and that its final
   message is exactly one JSON object per its definition. It implements every
   step of the plan in order and commits per step. While it works you do nothing
   in its worktree. Its report arrives as a message; save it as
   `do-report.json`. `openPoints` non-empty → decide: a question the code can
   answer goes to a `task-investigator` subagent and back to the teammate by
   `SendMessage`; a question only the engineer can answer → status `blocked`
   with the reason, report, stop.

3. **Review.** Spawn `task-reviewer` (fresh subagent, never the teammate) with:
   the plan path, the worktree path, the diff range `<base>..<head>` from the
   report, and the instruction that its final message is one JSON object. Save it
   as `review-report.json`. `changes_required` → `SendMessage` the blocking
   findings to the teammate verbatim; it fixes and reports again; then one more
   review of the new diff. Still blocking after the second round → status
   `blocked` with the findings, stop. `advice` findings go into `pr.md`, not into
   the code.

4. **Checks.** In the worktree, yourself: `mise exec -- pnpm build` and
   `mise exec -- pnpm verify` (one verify at a time; retry rule from
   `PIPELINE.md`). Red → send the literal output to the teammate; three attempts,
   then `blocked`. Keep the last output's tail for `pr.md`.

5. **Deliver.**
   - Single mode (no `--base`): `git -C <worktree> push -u origin <branch>`, then
     `gh pr create --repo yokeloop/mypi --base main --head <branch>` with title
     `<KEY>: <task title>` and a body: the goal, the plan's derive URL, the steps
     done, the checks with their exit codes, the review verdict, open advice, and
     the ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   - Batch mode (`--base batch/<name>`): push the task branch, then merge it in
     the batch worktree that `/batch` owns
     (`<engine>/projects/yokeloop/mypi--batch-<name>`):
     `git -C <batch worktree> merge --no-ff <branch> -m "Merge <KEY>: <title>"`
     and push the batch branch. No PR per task.
   Write `pr.md` in the task folder: PR URL (or batch merge SHA), checks, review.

6. **Record.** `$BIN/mp-task progress <KEY> "Реализовано, ревью чистое,
   проверки зелёные: <PR url | batch merge>" plan.md do-report.json
   review-report.json pr.md`; `$BIN/mp-task status <KEY> review "ждёт ручной
   проверки: <url>"`; `$BIN/mp-home-commit "<KEY>: implemented, PR"`. Ask the
   teammate to shut down (`SendMessage` «shut down»; `TaskStop` if it does not
   answer).

7. **Report** in a few lines: the PR URL or batch merge, the checks, the review
   verdict, open advice, and «ждёт вашей ручной проверки; /ship <KEY> мержит».

A stage you cannot pass becomes `blocked` with the literal failing output in the
reason and in `progress.md`; the worktree and branch stay as they are.
