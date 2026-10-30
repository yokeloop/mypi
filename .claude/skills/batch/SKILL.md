---
name: batch
description: Run several tasks of one registered project in a row without per-task approval — plan (auto, published to derive for the record), implement, review, checks — each merged into one batch branch; one PR batch/<name> → main at the end for the engineer's manual check. Triggered by "/batch <name> <KEY> [<KEY>…]".
---

# /batch — a pack of tasks into one branch

Read `docs/PIPELINE.md` in the engine root first. The typed command approves every
key in it: plans are still written and published (the record matters), but nobody
waits for them. Tasks run strictly one after another in the order typed: the checks
of one project run one at a time (MP's `pnpm verify` cannot run twice at once), and
each next task builds on the previous one's merge. `BIN=scripts/pipeline` (relative to the engine root, every session's working directory).

## Step 0 — session scope

`$BIN/mp-task scope`, then apply the «Session scope» rule of `docs/PIPELINE.md` to
`/batch`: `global` — continue when every key has the same code (keys of several
projects get the «mixes projects» text); `P` — continue when every key has the code
`P`; `P-N` — refused; an argument that is not a key, a malformed session key or a
non-zero exit — refused. A refusal prints its text from `docs/PIPELINE.md` and stops. This step
runs before the status checks in «Preconditions», before `git fetch`, before the
batch branch is created or pushed («Batch branch») and before the batch score is
written. The nested plan and do runs of the batch go in this same session and pass
their own Step 0 with the same key.

## Preconditions

- Every key exists and is `new`, `planning`, `in_progress` (resume) or `review`
  (already merged into this batch — skipped). Anything else → stop before starting.
- Order check: for every key, its dependencies from `source.md` must be `merged`,
  `done`, or earlier in this same list. A violation is reported with the right
  order suggested; `--force` after the list overrides.
- `$BIN/mp-task project <first KEY>` gives `checkoutPath`, `home` and `repository`;
  `checkoutPath` or `repository` `null` → say so and stop.

## Batch branch

`<base clone>` is the project's `<checkoutPath>`.

1. `git -C <base clone> fetch -q origin`. If `origin/batch/<name>` does not exist:
   `git -C <base clone> branch batch/<name> origin/main && git -C <base clone>
   push -u origin batch/<name>`.
2. Batch worktree: `<checkoutPath>--batch-<name>` on
   `batch/<name>` (`git -C <base clone> worktree add <path> batch/<name>` when
   missing). Merges happen there; never in the base clone.
3. Batch score: `<project home>/batches/<name>.md` — the keys in order with a
   checkbox each, the PR URL at the end. Commit with
   `$BIN/mp-home-commit <CODE> "<message>"` (it stages `batches` too).

## Per key, in order

1. Skip if already `review` with `pr.md` naming this batch.
2. Plan: run the `/plan <KEY> --auto` procedure (Skill `plan`) unless the
   task folder already has `plan.md` and `derive.json` with no open threads.
3. Do: run the `/do <KEY> --base batch/<name>` procedure (Skill `do`); its
   batch mode merges the task branch `--no-ff` into the batch worktree and pushes.
4. `blocked` from either → stop the batch here: later keys stay untouched, the
   report names the failing key and the literal reason. Re-typing the same command
   resumes: merged keys are skipped.

## Finish

1. In the batch worktree: the project's checks (by «Checks» of `docs/PIPELINE.md`;
   when the project's instructions name none, the check commands of the plans of all
   keys of the batch, in order) once more on the merged result (semantic conflicts between tasks merge clean
   and only checks expose them). Red → report with the literal output, open no PR.
2. `gh pr create --repo <repository> --base main --head batch/<name>` with title
   `Batch <name>: <KEY>, <KEY>, …` and a body listing per key: title, plan URL,
   review verdict, checks; then the ending
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
3. For every key: `$BIN/mp-task status <KEY> review "в пачке <name>, ждёт ручной
   проверки: <PR url>"`. Append the PR URL to the batch score;
   `$BIN/mp-home-commit <CODE> "batch <name>: PR"`.
4. Report: the PR URL, the keys in order with their review verdicts, open advice,
   and «ждёт вашей ручной проверки; /ship batch/<name> мержит».
