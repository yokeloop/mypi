---
name: flow
description: Run one or more tasks of one registered project through plan → do → review → checks, one task at a time, in an order the lead announces before the start; every decision goes to the engineer through AskUserQuestion and the run waits for the answer; each task merges into one flow branch, one PR flow/<name> → the project's PR target at the end for the engineer's manual check. Triggered by "/flow <name> <KEY> [<KEY>…]".
---

# /flow — tasks of one project into one branch, decisions to the engineer

Read `docs/PIPELINE.md` in the engine root first; its section «Where /flow waits
for the engineer» lists every stop of this skill. Work inline in this chat:
questions reach the engineer only from here, subagents and teammates cannot ask.
The typed command approves the plans of its keys: plans are still written and
published on derive (the record matters), and the engineer's answers to their
forks are part of that approval. One key is the ordinary case: `/flow <name>
<KEY>`. `BIN=scripts/pipeline` (relative to the engine root, every session's
working directory).

«Flow» in this skill is the run. The project's flow (`flow.json`,
`$BIN/mp-task flow`) is the project's branch and merge settings, which the run
reads.

## Step 0 — session scope

`$BIN/mp-task scope`, then apply the «Session scope» rule of `docs/PIPELINE.md` to
`/flow`: `global` — continue when every key has the same code (keys of several
projects get the «mixes projects» text); `P` — continue when every key has the code
`P`; `P-N` — continue when every key is `P-N` or its subtask by
`$BIN/mp-task subtasks P-N`; an argument that is not a key (other than the run
name), a malformed session key or a non-zero exit — refused. A refusal prints its text from
`docs/PIPELINE.md` and stops. This step runs before «Preconditions», before
`git fetch`, before the flow branch is created or pushed and before the flow score
is written. The nested plan and do runs go in this same session and pass their
own Step 0 with the same key; the subtasks of `P-N` pass it by the same rule.

## Preconditions

- The first argument is the run name `<name>`, not a task key; at least one key
  follows. Otherwise print `usage: /flow <name> <KEY> [<KEY>…]` and stop.
- Every key exists and is `new`, `planning`, `in_progress` (resume) or `review`
  (already merged into this flow — skipped). Anything else → stop before starting.
- `$BIN/mp-task project <first KEY>` gives `checkoutPath`, `home` and `repository`;
  `checkoutPath` or `repository` `null` → say so and stop.
- `$BIN/mp-task flow <first KEY>` gives the project's `integration` and `prTarget`;
  a non-zero exit → print its error and stop before any write.

## Subtasks

Before the flow score is written, run `$BIN/mp-task subtasks <KEY>` for every typed
key. The run list: for each typed key, in the typed order, its descendants in the
order of the `subtasks` output, then the key itself; a repeated key is dropped and
its first occurrence stays. The status of each subtask decides by «Subtasks» of
`docs/PIPELINE.md`: skipped, taken like a typed key, or one question — header
`Подзадача`, options «Пропустить (рекомендую)» and «Включить», the reason from
`$BIN/mp-task show <KEY>` in the question text. An included subtask gets
`$BIN/mp-task status <KEY> planning "в потоке <name>: включена инженером"`.

## Order

Before any write, compute the order of the keys. The base is the run list
(subtasks before their parent). Then the dependencies from the «Связи» section of
each `source.md` (a key goes after the keys of this run it depends on): a stable
topological reordering that never puts a parent before its subtasks. Then the files
each card names — tasks touching the same files go one after another, the one the
others build on first — where those constraints allow it. A cycle between the tree
and «Связи» is a question to the engineer. Announce it in the chat: the keys in
order, a mark `подзадача <parent>` on each subtask, one line of reasoning per key,
then on a line of its own the skipped subtasks with their status. Then go on
without waiting for a confirmation. A dependency outside the run that is not
`review`, `merged` or `done` is a question to the engineer before the start
(wait for it, or go on and record it as `/do --force` does).

## Flow branch

`<base clone>` is the project's `<checkoutPath>`.

1. `git -C <base clone> fetch -q origin`. If `origin/flow/<name>` does not exist:
   `git -C <base clone> branch flow/<name> origin/<integration> && git -C <base clone>
   push -u origin flow/<name>`.
2. Flow worktree: `<checkoutPath>--flow-<name>` on `flow/<name>`
   (`git -C <base clone> worktree add <path> flow/<name>` when missing). Merges
   happen there; never in the base clone.
3. Flow score: `<project home>/flows/<name>.md` — the branch with its base SHA, the
   worktree, the announced order expanded with subtasks with a checkbox per key,
   the list of skipped subtasks, later the PR URL. Commit
   with `$BIN/mp-home-commit <CODE> "<message>"` (it stages `flows` too).

## Reconnaissance up front

The `plan-scout` runs of every key that still needs a plan (the task folder has no
`plan.md` with `derive.json`, or its plan has open threads) may start at once, in
parallel, as step 3 of the `/plan` procedure. Note per key the SHA of
`origin/flow/<name>` when its scout ran. Questions and plans still go one key at a
time.

## Per key, in the announced order

Strictly one task at a time: the next key's `/do` starts only after the current
key is recorded in the flow score.

1. Skip if already `review` with `pr.md` naming this flow.
2. **Plan.** The `/plan <KEY>` procedure (Skill `plan`), unless the task folder
   already has `plan.md` and `derive.json` with no open threads. Its forks go to the
   engineer one at a time through `AskUserQuestion`, the recommendation first; no
   answer — no next step. The engineer's answers go into the plan verbatim as
   decisions. An edit of the lead to a plan beyond the plan-writer's output is a
   question to the engineer or an explicit line in the final report. The plan of
   the next key may be written while the current key executes.
3. **Base check.** Before the key's `/do`: `git -C <base clone> fetch -q origin`,
   then `git -C <base clone> log --stat <scout SHA>..origin/flow/<name>`. When it
   touches a file the scout's facts name, run the scout again for this key and
   bring its new facts to the plan by the `/plan` procedure.
4. **Do.** The `/do <KEY> --base flow/<name>` procedure (Skill `do`) in its flow
   mode: it merges the task branch `--no-ff` into the flow worktree and pushes;
   every stop of `/do` is a question to the engineer («Flow mode» of the `do`
   skill).
5. **Live acceptance**, only when the plan's Acceptance names a check on a stand.
   It is part of the run, not a question: follow `docs/MANUAL-ACCEPTANCE.md` on
   the flow worktree's head: the checklist is written before the start, checks are
   independent, the evidence goes into the task folder. Known pitfalls: Herdr
   restores the stand session's layout from a past run; tabs opened by `/open` load
   the user's personal MCP servers; start messages spend model turns (count them in
   the budget); teardown kills the processes by the stand's `XDG_STATE_HOME`, never
   `pkill -f` by path (it kills the driving shell), then stops and deletes the
   Herdr session, and only then removes the directory. A failure inside the plan's
   scope goes to the key's teammate: fix in the task worktree, one more review
   round, the checks, a new `--no-ff` merge into the flow worktree, the failed
   items again. A failure that needs a decision is a question. A stand that would
   exceed its model-turn or time budget is a question too.
6. **Record.** Tick the key in the flow score with its merge SHA, the review
   verdict and the acceptance result; `$BIN/mp-home-commit <CODE> "flow <name>:
   <KEY> merged"`. Then shut the key's teammate down (`SendMessage` «shut down»;
   `TaskStop` if it does not answer).

Re-typing the same command resumes: it expands the subtasks again, and keys
already in `review` for this flow are skipped.

## Questions

Every stop listed in «Where /flow waits for the engineer» of `docs/PIPELINE.md` is
one `AskUserQuestion`: header ≤ 12 characters, 2–4 options, the recommended one
first and labelled `(рекомендую)`, one line of reasoning per option, the literal
output or finding in the question text. The run waits for the answer; no retry,
no bypass, no weakened check in its place. The answer is recorded in the key's
`progress.md` and named in the final report. `blocked` is set only when the
engineer answers so; the run then stops, later keys stay untouched.

## Finish

1. In the flow worktree: the project's checks (by «Checks» of `docs/PIPELINE.md`;
   when the project's instructions name none, the check commands of the plans of all
   keys, in order) once more on the assembled result (semantic conflicts between
   tasks merge clean and only checks expose them). Red → a question with the
   literal output; no PR until it is answered.
2. `gh pr create --repo <repository> --base <prTarget> --head flow/<name>` — also for
   one key — with title `Flow <name>: <KEY>, <KEY>, …` and a body listing per key:
   title, plan URL, review verdict, checks, live acceptance (or «not required»),
   the engineer's answers taken on the way; then the ending
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
3. `gh pr checks <url> --watch`. Red only on the test budget with `fail 0` →
   report it to the engineer with the measurements, no rerun loop. Any other red →
   a question with the literal output.
4. For every key: `$BIN/mp-task status <KEY> review "в потоке <name>, ждёт ручной
   проверки: <PR url>"`. Append the PR URL to the flow score;
   `$BIN/mp-home-commit <CODE> "flow <name>: PR"`.
5. Report: the PR URL, the keys in order with their review verdicts and acceptance,
   open advice, the engineer's answers, the lead's edits of plans, and «ждёт вашей
   ручной проверки; /ship flow/<name> мержит».

## Never

- A GitHub Release or any other publication, a migration of the personal database,
  the engine update: only on the engineer's separate permission, never as a step of
  the run.
- Force-push, deleting a remote branch, merging the PR: never; the PR is merged by
  `/ship flow/<name>`.
