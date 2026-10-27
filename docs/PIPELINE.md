# mypi task pipeline

Tooling for developing mypi from the main chat started in the engine root. It is
tracked in the engine repository: this file, `docs/PLAN-FORMAT.md`, the scripts in
`scripts/pipeline/`, the skills `/plan`, `/do`, `/batch`, `/ship`, `/queue` in
`.claude/skills/` and the roles in `.claude/agents/` (copied from yokemate). Claude
Code loads the skills and roles when it starts in the engine root; the scripts act on
the installation they are run from and refuse any other working directory.

The flow per task: `/plan` → the engineer reads the plan on derive → `/do`
→ automatic review and checks → PR → the engineer's manual check → `/ship`.
`/batch` runs plan and do for several tasks in a row and merges them into one
batch branch the engineer checks as a whole.

## Places

- Installation root: the installed engine checkout, never edited, with `home/` and
  `projects/` beside it. The main chat's cwd; every path below is relative to it. The `mypi` CLI is `mise exec -- node dist/src/cli/main.js` there;
  `scripts/pipeline/mp-task` wraps it.
- Base clone: `projects/yokeloop/mypi`, branch `main`.
  The pipeline only fetches and fast-forwards it; never commit or switch there.
- Task worktree: `projects/yokeloop/mypi--<KEY>-<slug>`
  on branch `task/<KEY>-<slug>`. One writer per worktree. `scripts/pipeline/mp-worktree`
  creates it and installs dependencies.
- Task folder in mypi home (its own Git repository, direct `main`):
  `home/projects/yokeloop/mypi/requests/<KEY>-<slug>/`
  (`requests/` becomes `tasks/` after the v2 rename). Files: `source.md`
  (registration, immutable), `plan.md`, `derive.json`, `progress.md`,
  `do-report.json`, `review-report.json`, `pr.md`. After every write:
  `scripts/pipeline/mp-home-commit "<message>"`.
- Derive: the general plan is `b7wieok9`
  (https://draft.yokeloop.com/artifacts/mypi-v2-b7wieok9); every task plan is
  its own artifact, `short_id` and `url` in the task folder's `derive.json`.
- `scripts/pipeline/mp-task` subcommands: `show`, `dir`, `slug`, `source`, `status`,
  `progress`, `v2` (table of the v2 tasks). Run it without arguments for usage.

## Temporary scripts

Two of the three scripts stand in for mypi features the v2 plan adds later; each
is removed by the task that makes it redundant, and that task's done criteria say
so:

- `scripts/pipeline/mp-task` — until MP-36 (T5, Claude adapter) gives the main
  chat on Claude Code the mypi MCP (`task_show`, `task_update`, `inbox`); then
  the skills call the MCP tools and the script goes.
- `scripts/pipeline/mp-worktree` — until MP-39 (T8) ships `mypi task worktree`;
  then the skills call that command and the script goes.
- `scripts/pipeline/mp-home-commit` has no planned replacement: `context commit`
  commits locally only and publication goes through `backup --publish`.

## Roles

Subagent types from `.claude/agents/`: `plan-scout` (read-only reconnaissance),
`plan-writer` (writes `plan.md` by `docs/PLAN-FORMAT.md`), `task-executor` (implements
one task in its worktree), `task-reviewer` (fresh-eyes review of a diff against the
plan), `task-investigator` (one question about existing behaviour, read-only).

The executor runs as an in-process **teammate** named by the key in lower case
(`mp-33`), spawned with `subagent_type: task-executor` and `name`. It stays alive
through the review loop, so reviewer findings go to it by `SendMessage` and it fixes
in the same context. Reviewer and investigator are ordinary subagents: fresh
context every time, never the lead's conclusions. When a task reaches `review`
the lead asks the teammate to shut down.

What every executor prompt carries: the task key, the plan path, the worktree path,
the task folder path, the base branch, this file's path, and the rule that its
final message is exactly one JSON object per its definition.

## Statuses in mypi

`new → planning → in_progress → review → merged → done`, plus `blocked`.

- `planning`: `plan.md` written and published to derive; waiting for the engineer.
  Set by `/plan`.
- `in_progress`: `/do` started; the worktree exists.
- `review`: implementation finished, review clean, checks green, PR open (single
  mode) or merged into the batch branch (batch mode). Waiting for the engineer's
  manual check.
- `merged`: the PR is merged into `main` by `/ship`.
- `done`: the engineer's word after the installed engine runs the change. The
  pipeline never sets it.
- `blocked`: the pipeline stopped on an open point; the reason names it.

Every status reason carries the relevant link: derive URL or PR URL.

## Approval semantics

- An approved plan is the engineer typing `/do <KEY>` or `/batch …`. No
  other signal counts; a published plan queues nothing.
- Open comment threads on the plan artifact (`catch_up` with `comments: open`) are
  remarks. `/plan` reworks the plan and republishes, resolving the threads with
  `addresses`. `/do` refuses to start while a thread is open, unless typed with
  `--force`.

## Checks

- In the worktree: `mise exec -- pnpm build`, then `mise exec -- pnpm verify`
  (`pnpm test` is the fast profile, not sufficient for done).
- `pnpm verify` runs in the fixed systemd user unit `mypi-tests`; two runs at once
  fail by design. One verify at a time on the whole machine. On
  `Unit mypi-tests already exists` or `already running`: wait 60 s and retry, at
  most 5 times, then report it as an open point.
- Tests use disposable data under the sandbox only. Never the personal database,
  never `home/`.

## Branches and merging

- Single mode: base `origin/main`; PR `task/<KEY>-<slug>` → `main`, merged by
  `/ship` after the engineer's check.
- Batch mode: base `batch/<name>` created from `origin/main` and pushed; each task
  branch merges `--no-ff` into `batch/<name>` right after its review and checks;
  one PR `batch/<name>` → `main` at the end. The engineer checks the batch branch.
  Tasks run strictly one after another, in the order typed.
- Commits: English, imperative, one concern, no code comments, no attribution
  trailers (the `task-executor` rule).
- Never force-push. Never delete a remote branch. Worktrees are removed only by
  `/ship`, after the merge is verified and the tree inspected.

## Hard rules, from the engine's AGENTS.md

- Never edit the installed engine, its `AGENTS.md` or shipped resources. Never run
  migrations, bootstrap, release, restore or the engine update: those are the
  engineer's separate authorizations (task T14 of the plan).
- Record state in mypi (`status`, `progress` with artifacts) and in the task
  folder; commit home after each change.
- A stage is passed by its named condition with the command output as evidence,
  never by "looks done". A check still red after three fix attempts is an open
  point, not a fourth attempt. Never a weakened check.
