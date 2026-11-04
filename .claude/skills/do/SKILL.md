---
name: do
description: Execute one approved task of a registered project by its plan — worktree, task-executor teammate implementing step by step, fresh task-reviewer, fix loop, the project's checks, push and PR (or merge into a flow branch), status review for the engineer's manual check. Typing it is the plan's approval. Triggered by "/do <KEY> [--base flow/<name>] [--force]".
---

# /do — execute an approved plan

Read `docs/PIPELINE.md` in the engine root first. The typed command is the
engineer's approval of the published plan; the plan is the whole scope — never
widen it, never improve adjacent code. `BIN=scripts/pipeline` (relative to the engine root, every session's working directory). You are
the lead: you run the stages below and keep score; the code is written by the
teammate.

## Step 0 — session scope

`$BIN/mp-task scope`, then apply the «Session scope» rule of `docs/PIPELINE.md` to
`/do <KEY>`: `global` — any key; an organization (`org` is not `null`) — continue
only when the key's code is in `codes`; `P` — continue only when the key has the code `P`;
`P-N` — continue only for `/do P-N`; anything else (an argument that is not a key, a
malformed session key, a non-zero exit) — print the refusal text from
`docs/PIPELINE.md` and stop. This step runs before «Preconditions»: no
`$BIN/mp-task show`, no `catch_up`, no `mp-worktree` before it.

## Preconditions

1. `$BIN/mp-task show <KEY>`: status `planning` (fresh start) or `in_progress`
   (resume). Anything else → say so and stop.
2. The task folder (`$BIN/mp-task dir <KEY>`) has `plan.md` and `derive.json`.
   `catch_up` on that `short_id` with `comments: open`: an open thread means the
   plan is not approved — say which threads are open, suggest `/plan <KEY>`,
   stop. `--force` skips this check and the fact goes into `progress.md`.
3. Dependencies listed in `source.md` («Связи → Зависит от»): each must be
   `review`, `merged` or `done`, or already merged into the same
   flow base.
   Otherwise stop and name the missing one; `--force` proceeds and records it.
4. `$BIN/mp-task project <KEY>`: `checkoutPath` `null` → say the project has no
   registered clone and stop; in single mode `repository` `null` → say there is no
   repository to open the PR in and stop.
5. The project's checks by «Checks» of `docs/PIPELINE.md`: the project's
   instructions (`<checkoutPath>/AGENTS.md`, else `CLAUDE.md`; MP — `pnpm build` and
   `pnpm verify`), else the check commands of the Acceptance section of `plan.md`.
   Neither names any → say what is missing (no checks in the project's instructions
   nor in the plan) and stop: no worktree, no status change.
6. `$BIN/mp-task flow <KEY>` → the project's flow: `integration`, `prTarget`,
   `mergeMethod`. A non-zero exit → print its error and stop before any write
   (an invalid `flow.json` is fixed in the project home first).

## Stages

Score is `<task folder>/progress.md`: the plan path on the first line, a checkbox
per stage below, ticked the moment its condition is met. A resumed run starts at
the first unchecked box and never redoes checked work. `progress.md` is a live
file (checkboxes, `blocked` reasons, `--force`, entries of `/ship` and of the
manual check); `/ship` registers it.

1. **Worktree.** `$BIN/mp-worktree <KEY> [--base flow/<name>]` → JSON; without
   `--base` it takes the base and the task branch from the project's flow. `dirty:
   true` → stop and show `git status` of the worktree; nothing is cleaned
   automatically. Status: `$BIN/mp-task status <KEY> in_progress "worktree
   <path>, base <base_ref>"`.

2. **Executor.** Spawn a teammate: `Agent` with `subagent_type: task-executor`,
   `name: <key in lower case>` (`mp-33`), prompt carrying: the key, the plan path,
   the worktree path, the task folder path, the base branch (`base_ref` from
   `mp-worktree`), the path of
   `PIPELINE.md`, the project's checks from Preconditions 5 (for MP:
   `mise exec -- pnpm build`, `mise exec -- pnpm verify`, one verify at a time, the
   retry rule), the rule
   that commits are English imperative without trailers, and that its final
   message is exactly one JSON object per its definition. It implements every
   step of the plan in order and commits per step. While it works you do nothing
   in its worktree. Its report arrives as a message; save it as
   `do-report.json`. `openPoints` non-empty → decide: a question the code can
   answer goes to a `task-investigator` subagent and back to the teammate by
   `SendMessage`; a question only the engineer can answer → status `blocked`
   with the reason, report, stop (flow mode: a question, see «Flow mode»).

3. **Review.** Spawn `task-reviewer` (fresh subagent, never the teammate) with:
   the plan path, the worktree path, the diff range `<base>..<head>` from the
   report, and the instruction that its final message is one JSON object. Save it
   as `review-report.json`. `changes_required` → `SendMessage` the blocking
   findings to the teammate verbatim; it fixes and reports again; then one more
   review of the new diff. Still blocking after the second round → status
   `blocked` with the findings, stop (flow mode: a question, see «Flow mode»). In
   single mode `advice` findings go into `pr.md`, not into the code; flow mode
   treats them by «Flow mode».

4. **Checks.** In the worktree, yourself: the project's checks (Preconditions 5);
   for MP one verify at a time and the retry rule from `PIPELINE.md`. Red → send the literal output to the teammate; three attempts,
   then `blocked` (flow mode: a question). Keep the last output's tail for `pr.md`.

5. **Deliver.**
   - Single mode (no `--base`): `git -C <worktree> push -u origin <branch>`, then
     `gh pr create --repo <repository> --base <prTarget> --head <branch>` with title
     `<KEY>: <task title>` and a body: the goal, the plan's derive URL, the steps
     done, the checks with their exit codes, the review verdict, open advice, and
     the ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   - Flow mode (`--base flow/<name>`): push the task branch, then merge it in
     the flow worktree that `/flow` owns
     (`<checkoutPath>--flow-<name>`):
     `git -C <flow worktree> merge --no-ff <branch> -m "Merge <KEY>: <title>"`
     and push the flow branch. No PR per task.
   Write `pr.md` in the task folder: PR URL (or flow merge SHA), checks, review.
   The manual check appends its own section to it later; step 6 registers it.

6. **Record.**
   `$BIN/mp-task progress <KEY> "Реализовано, ревью чистое, проверки зелёные: <PR url | flow merge>" plan.md pr.md do-report.json review-report.json`.
   `$BIN/mp-task status <KEY> review "ждёт ручной
   проверки: <url>"`; `$BIN/mp-home-commit <KEY> "<KEY>: implemented, PR"`. In single mode
   ask the teammate to shut down (`SendMessage` «shut down»; `TaskStop` if it does
   not answer). In flow mode the teammate stays: `/flow` shuts it down after the
   key is recorded in the flow score.

7. **Report** in a few lines: the PR URL or flow merge, the checks, the review
   verdict, open advice, and «ждёт вашей ручной проверки; /ship <KEY> мержит». In
   flow mode the report goes to the run, which continues with its next step.

A stage you cannot pass becomes `blocked` with the literal failing output in the
reason and in `progress.md`; the worktree and branch stay as they are. In flow
mode such a stage is first a question to the engineer («Flow mode»).

## Flow mode

`--base flow/<name>` is flow mode: `/flow` runs this procedure inline in its own
chat, so questions reach the engineer. Each of these stops is one
`AskUserQuestion` by «Questions» of the `flow` skill, and the run waits for the
answer instead of setting `blocked`:

- `openPoints` only the engineer can answer (stage 2);
- a review finding that needs a decision beyond the plan (stage 3);
- findings still blocking after the second review round (stage 3);
- a fix — of a finding or of advice — that would change the plan's agreed text or
  behaviour (stage 3);
- red checks the plan's scope cannot fix, or still red after three attempts
  (stage 4);
- an exceeded budget (the test budget, the model-turn budget of a stand);
- a change of the task's scope, or a new task found on the way;
- an unmet dependency of «Preconditions» 3, a dirty worktree in stage 1, and any
  other stage this procedure would set `blocked` at.

No retry and no bypass in place of the answer. The answer goes into
`progress.md` (`вопрос: <question> — ответ: <answer>`) and the stage goes on by
it; `blocked` is set only when the engineer answers so. Review advice: a cheap
fix inside the plan's scope goes to the teammate by `SendMessage`, then one more
review round of the new diff; the rest goes into `pr.md`.
