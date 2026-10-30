# mypi task pipeline

Tooling for running the tasks of any registered project from the engine root; every
session starts there, so each pipeline skill checks the session scope first (see
«Session scope»). It is tracked in the engine repository: this file, `docs/PLAN-FORMAT.md`, the scripts in
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
- Base clone: the project's `checkoutPath` from `scripts/pipeline/mp-task project <KEY>`
  (MP: `projects/yokeloop/mypi`), branch `main`.
  The pipeline only fetches and fast-forwards it; never commit or switch there.
- Task worktree: `<checkoutPath>--<KEY>-<slug>`
  on branch `task/<KEY>-<slug>`. One writer per worktree. `scripts/pipeline/mp-worktree`
  creates it and installs dependencies only when it has a `pnpm-lock.yaml`.
- Project home: the `home` field of `mp-task project` (`home/projects/<org>/<slug>`).
  The clone path comes only from `checkoutPath`, the home only from `org/slug`; neither
  is derived from the other (TBA: clone `projects/TB-FF/tbff-automations`, home
  `home/projects/tb-ff/tbff-automations`).
- Task folder in mypi home (its own Git repository, direct `main`):
  `<project home>/tasks/<KEY>-<slug>/`
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
  `scripts/pipeline/mp-home-commit <KEY|CODE> "<message>"` (the `requests`, `tasks`
  and `batches` folders of that project).
- Batch: `<project home>/batches/<name>.md`.
- Derive: the general plan is the derive artifact a task card links, if any (the v2
  cards of MP link `b7wieok9`, https://draft.yokeloop.com/artifacts/mypi-v2-b7wieok9);
  every task plan is its own artifact, `short_id` and `url` in the task folder's
  `derive.json`.
- `scripts/pipeline/mp-task` subcommands: `scope` (session scope as JSON), `project`
  (project record as JSON: `code`, `project`, `checkoutPath`, `home`, `repository`;
  takes a CODE or a KEY), `show`, `dir`, `slug`, `source`, `status`, `progress`,
  `board` (board rows of a project as JSON lines; terminal statuses with `all`). Run
  it without arguments for usage.

## Session scope

Every session (the main chat, a project chat, a task chat) starts in the engine root
and sees the pipeline skills. Each of the five skills checks the session scope as its
Step 0.

The key: `scripts/pipeline/mp-task scope` prints `{"key", "project", "source"}`. It
takes the `sessions` row with this conversation's agent and native id
(`CLAUDE_CODE_SESSION_ID`, else `PI_SESSION_ID`; it is set inside subagents too and
is the parent chat's id), else `MYPI_SCOPE` (set by `/open`), else `global`. This is
the order of `warmup` without an argument, except the live record by pid: through
`mise exec` the pid does not match, and `MYPI_SCOPE`, which `/open` sets to the same
key, takes its place. The subcommand only reads (`mypi sessions`); neither `warmup`
nor `inbox` is used for the check, because both mark events delivered.

The rule:

- `global`: `/plan`, `/do` and `/ship` take tasks of any project; `/batch` and
  `/ship batch/<name>` take the keys of one project.
- `P` (any project): every typed key has the code `P`; a batch holds keys of `P`,
  `/ship batch/<name>` takes a batch of project `P`.
- `P-N`: `/plan` and `/do` only when every typed key equals `P-N`; `/ship` only when
  every typed argument equals `P-N`; `/batch` and `/ship batch/<name>` are refused.
- A typed argument that is not a key `CODE-N` (other than `batch/<name>` of `/ship`
  and the batch name of `/batch`), a malformed session key (`project` is `null` and
  the key is not `global`) or a non-zero exit of `mp-task scope`: refused.
- `/board`: in a session of project P or its task P-N — the board of P; a typed CODE
  must equal P. In global — the typed CODE, MP by default. A malformed key, an unknown
  code or a non-zero exit of mp-task scope — refused.
- A non-zero exit of `mp-task scope`: refused, with its output.

A refusal prints its text and stops. Nothing runs before it except `mp-task scope`:
no `mp-task show/status/progress`, no `git fetch`, no `mp-worktree`, no
`mp-home-commit`, no derive calls, no subagents (`/board` also runs `mp-task project`
and `project list`). The texts (`<cmd>`, the typed
arguments and `<key>` substituted):

- `/board` with another project's code: `/board <CODE> is not allowed in session scope <key>; this chat shows the board of <P> only. Use /board here or /open global for another project.`
- `/board` with a malformed key: `The board cannot tell this session's project (scope <key>). Open the main chat with /open global.`
- `/board` with an unknown code: `Unknown project code <P>; registered codes: <codes>.`
- a changing skill with another project's key: `/<cmd> <args> is not allowed in session scope <key>; nothing was written. This chat runs tasks of <P> only; run it in that task's or project's chat (/open <CODE>) or in the main chat (/open global).`
  (`<CODE>` is the code of the typed key.) In a `P-N` chat append: ` This chat may run /plan P-N, /do P-N and /ship P-N only.`
- a changing skill with a malformed session key or a non-zero `mp-task scope`: `/<cmd> cannot tell this session's project (scope <key>); nothing was written. Run it in the main chat (/open global).`
- a changing skill with an argument that is not a key: `/<cmd>: <arg> is not a task key (CODE-N); nothing was written.`
- `/batch` in `global` with keys of several projects: `/batch <args> mixes projects <codes>; a batch holds tasks of one project; nothing was written.`

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

The checks of a task come from the project's instructions: `<checkoutPath>/AGENTS.md`,
else `<checkoutPath>/CLAUDE.md`.

- MP:
  - In the worktree: `mise exec -- pnpm build`, then `mise exec -- pnpm verify`
    (`pnpm test` is the fast profile, not sufficient for done).
  - `pnpm verify` runs in the fixed systemd user unit `mypi-tests`; two runs at once
    fail by design. One verify at a time on the whole machine. On
    `Unit mypi-tests already exists` or `already running`: wait 60 s and retry, at
    most 5 times, then report it as an open point.
- When the project's instructions name no checks, the check commands of the approved
  plan (its Acceptance section) are the checks: the engineer approved the plan, and
  with it those commands.
- When neither names any, `/do` stops in its Preconditions, before the worktree and
  before any status change, and says what is missing.
- Every project: tests use disposable data under the sandbox only. Never the personal
  database, never `home/`.

## Branches and merging

- Single mode: base `origin/main` of the project's clone; PR `task/<KEY>-<slug>` →
  `main` in the `repository` from `mp-task project` (`gh pr create --repo
  <repository>`), merged by `/ship` after the engineer's check.
- Batch mode: the keys of one project; base `batch/<name>` created in the project's
  clone from `origin/main` and pushed, batch worktree `<checkoutPath>--batch-<name>`;
  each task branch merges `--no-ff` into `batch/<name>` right after its review and
  checks; one PR `batch/<name>` → `main` at the end. The engineer checks the batch
  branch. Tasks run strictly one after another, in the order typed.
- `/ship` merges with `gh pr merge --merge` unless the project's instructions name
  another method.
- Commits: English, imperative, one concern, no code comments, no attribution
  trailers (the `task-executor` rule).
- Never force-push. Never delete a remote branch. Worktrees are removed only by
  `/ship`, after the merge is verified and the tree inspected.

## Hard rules

- A task of any project never edits the installed engine, its `AGENTS.md` or shipped
  resources. Never run migrations, bootstrap, release or restore, nor, for MP, the
  engine update: those are the engineer's separate authorizations (for MP, task T14
  of the plan).
- Record state in mypi (`status`, `progress` with artifacts) and in the task
  folder; commit home after each change. Artifacts are only the write-once files
  and snapshots from «Places», never a live file. A repeated `status` with the
  same value writes nothing to the journal, so a rework reason goes into
  `progress`.
- A stage is passed by its named condition with the command output as evidence,
  never by "looks done". A check still red after three fix attempts is an open
  point, not a fourth attempt. Never a weakened check.
