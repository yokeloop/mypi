# mypi task pipeline

Tooling for developing mypi from the main chat (session scope `global` or `MP`)
started in the engine root; every session starts there, so each pipeline skill checks
the session scope first (see «Session scope»). It is tracked in the engine repository: this file, `docs/PLAN-FORMAT.md`, the scripts in
`scripts/pipeline/`, the skills `/plan`, `/do`, `/batch`, `/ship`, `/board` in
`.claude/skills/` and the roles in `.claude/agents/` (copied from yokemate). Claude
Code loads the skills and roles when it starts in the engine root; the scripts act on
the installation they are run from and refuse any other working directory.

The flow per task: `/plan` → the engineer reads the plan on derive → `/do`
→ automatic review and checks → PR → the engineer's manual check → `/ship`.
`/batch` runs plan and do for several tasks in a row and merges them into one
batch branch the engineer checks as a whole.

## Places

- Installation root: the installed engine checkout, never edited, with `home/` and
  `projects/` beside it. Every session's cwd; every path below is relative to it. The `mypi` CLI is `mise exec -- node dist/src/cli/main.js` there;
  `scripts/pipeline/mp-task` wraps it.
- Base clone: `projects/yokeloop/mypi`, branch `main`.
  The pipeline only fetches and fast-forwards it; never commit or switch there.
- Task worktree: `projects/yokeloop/mypi--<KEY>-<slug>`
  on branch `task/<KEY>-<slug>`. One writer per worktree. `scripts/pipeline/mp-worktree`
  creates it and installs dependencies.
- Task folder in mypi home (its own Git repository, direct `main`):
  `home/projects/yokeloop/mypi/tasks/<KEY>-<slug>/`
  (`requests/` until `mypi home migrate-tasks` has run on this home — T14 (MP-45);
  `scripts/pipeline/mp-task dir <KEY>` prints the actual folder). Files by kind:
  - write-once: `source.md` (task registration), `addendum.md` and other card
    addenda beside it, `do-report.json`, `review-report.json` (rewritten only in
    the `/do` fix loop, before they are registered);
  - snapshot (version in the name, never edited after registration):
    `plan-v<N>.md` (N is the derive version from `derive.json`, taken by `/plan`),
    `pr-final.md`, `progress-final.md` (taken by `/ship`);
  - live (rewritten and appended to, never registered): `plan.md` (the working
    copy that `/do`, the executor and the reviewer read), `derive.json`,
    `progress.md`, `pr.md`.

  A registered file is immutable (`mypi backup` checks every fingerprint). Never
  register a file that will still be written; register a snapshot whose name
  carries its version. After every write:
  `scripts/pipeline/mp-home-commit "<message>"`.
- Derive: the general plan is `b7wieok9`
  (https://draft.yokeloop.com/artifacts/mypi-v2-b7wieok9); every task plan is
  its own artifact, `short_id` and `url` in the task folder's `derive.json`.
- `scripts/pipeline/mp-task` subcommands: `scope` (session scope as JSON), `show`, `dir`,
  `slug`, `source`, `status`, `progress`, `v2` (table of the v2 tasks). Run it without arguments for usage.

## Session scope

Every session (the main chat, a project chat, a task chat) starts in the engine root
and sees the pipeline skills, but the skills belong to the project MP. Each of the
five skills therefore checks the session scope as its Step 0.

The key: `scripts/pipeline/mp-task scope` prints `{"key", "project", "source"}`. It
takes the `sessions` row with this conversation's agent and native id
(`CLAUDE_CODE_SESSION_ID`, else `PI_SESSION_ID`; it is set inside subagents too and
is the parent chat's id), else `MYPI_SCOPE` (set by `/open`), else `global`. This is
the order of `warmup` without an argument, except the live record by pid: through
`mise exec` the pid does not match, and `MYPI_SCOPE`, which `/open` sets to the same
key, takes its place. The subcommand only reads (`mypi sessions`); neither `warmup`
nor `inbox` is used for the check, because both mark events delivered.

The rule:

- `global` and `MP`: all five skills, without restriction.
- `MP-N`: `/plan` and `/do` only when every typed key equals `MP-N`; `/ship` only
  when every typed argument equals `MP-N` (`/ship batch/<name>` is refused);
  `/batch` and `/board` are refused.
- Any other key (another project, its task, a malformed `MYPI_SCOPE`): all five are
  refused.
- A non-zero exit of `mp-task scope`: refused, with its output.

A refusal prints its text and stops. Nothing runs before it except `mp-task scope`:
no `mp-task show/status/progress`, no `git fetch`, no `mp-worktree`, no
`mp-home-commit`, no derive calls, no subagents. The texts (`<cmd>`, the typed
arguments and `<key>` substituted):

- `/board`: `The board belongs to MP; this session's scope is <key>. Open the main chat with /open global or /open MP.`
- the changing skills: `/<cmd> <args> is not allowed in session scope <key>; nothing was written. Run it from the main chat (/open global or /open MP).`
  In an `MP-N` chat append: ` This chat may run /plan MP-N, /do MP-N and /ship MP-N only.`

This is an instruction for the agent, not access control: the scripts still work
from any session.

## Temporary scripts

Two of the three scripts stand in for mypi features the v2 plan adds later; each
is removed by the task that makes it redundant, and that task's done criteria say
so:

- `scripts/pipeline/mp-task` — stays after MP-36 (T5): the Claude adapter gives
  the main chat the mypi MCP (`task_show`, `task_update`), but the skills also
  read `inbox`, which arrives with MP-41 (T10); the script goes once the skills
  call the MCP tools.
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
  remarks. `/plan` reworks the plan and republishes, resolving each thread with
  `comment` and `set_state: resolved` and a reply saying what changed. `/do` refuses to start while a thread is open, unless typed with
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
  folder; commit home after each change. Artifacts are only the write-once files
  and snapshots from «Places», never a live file. A repeated `status` with the
  same value writes nothing to the journal, so a rework reason goes into
  `progress`.
- A stage is passed by its named condition with the command output as evidence,
  never by "looks done". A check still red after three fix attempts is an open
  point, not a fourth attempt. Never a weakened check.
