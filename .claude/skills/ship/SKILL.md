---
name: ship
description: After the engineer's manual check — bring each task PR (or a batch PR) onto main, wait for green checks, merge, set status merged, inspect and remove the worktree. Never updates the installed engine. Triggered by "/ship <KEY|batch/<name>> [<KEY>…]".
---

# /ship — merge what the engineer accepted

Read `docs/PIPELINE.md` in the engine root first. The typed command is the
engineer's word that the manual check passed; nothing new is planned or coded.
Keys ship strictly in the order typed, each next one onto the base the previous
one entered. `BIN=scripts/pipeline` (relative to the engine root, every session's working directory).

## Step 0 — session scope

`$BIN/mp-task scope`, then apply the «Session scope» rule of `docs/PIPELINE.md` to
`/ship` and every typed argument: `global` or `MP` — continue; `MP-N` — continue
only when every typed argument equals `MP-N` (`batch/<name>` in a task chat is
refused); any other key, or a non-zero exit — print the refusal text from
`docs/PIPELINE.md` and stop. This step runs before `pr.md` is read, before
`git fetch`, merge, push, `gh`, any status change and any worktree removal.

## Per key (or batch)

1. **Locate.** A key: status must be `review`, `pr.md` in its task folder names
   the PR and the worktree. A batch: the batch score in
   `home/projects/yokeloop/mypi/batches/<name>.md` names the PR and the keys.
   Anything else → say so and stop.
2. **Update from main.** In the worktree: `git fetch origin`; merge `origin/main`
   in (the repository's history keeps merge commits; never rebase a pushed task
   branch). Conflicts: read the neighbour's merged PR and this plan before
   touching a hunk; keep both intents; never `--ours`/`--theirs`; a hunk the plan
   cannot answer is resolved toward main and reported as an open point. A clean
   merge is untested: `mise exec -- pnpm build && mise exec -- pnpm verify` (one
   verify at a time). Red you cannot fix inside the plan's scope → stop, report
   the literal output, touch nothing further.
3. **Push and wait.** `git push`; `gh pr checks <url> --watch --fail-fast`. Red →
   stop and report.
4. **Merge.** `gh pr merge <url> --merge` (merge commits are the convention of
   this repository: `git log --merges` shows them). Then for the key (every key of
   a batch), in this order:
   1. `$BIN/mp-task status <KEY> merged "смержено в main: <merge sha>"`.
   2. If you mark the merge in `progress.md` (a line or a «смержено» checkbox),
      do it here: it is the last entry in `progress.md`; the manual check has
      already appended to `pr.md` by now.
   3. `cp <task folder>/pr.md <task folder>/pr-final.md` and
      `cp <task folder>/progress.md <task folder>/progress-final.md`.
   4. `$BIN/mp-task progress <KEY> "Смержено: <PR url>" pr-final.md progress-final.md`.
   5. After this `pr.md` and `progress.md` are not appended to; the `*-final.md`
      snapshots are immutable.
5. **Clean up.** Inspect the worktree: `git status --porcelain --ignored` — unique
   untracked files are moved to the task folder in home before removal, ignored
   build output is not. `git -C <base clone> worktree remove <worktree>`;
   the local branch may go (`git -C <base clone> branch -d`), the remote branch
   stays unless the engineer said otherwise. For a batch also remove the batch
   worktree.
6. `$BIN/mp-home-commit "<KEY>: shipped"` (plus the batch score for a batch).

## Report

Per key: the merge SHA, the checks before the merge, what was removed; for a
stop — the literal failing output and what stands untouched. Then one reminder:
the installed engine is not updated by this skill; the engineer runs the update
flow from `AGENTS.md` separately and sets `done` afterwards.
