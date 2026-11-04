# mypi task pipeline

Tooling for running the tasks of any registered project from the engine root; every
session starts there, so each pipeline skill checks the session scope first (see
«Session scope»). It is tracked in the engine repository: this file, `docs/PLAN-FORMAT.md`, the scripts in
`scripts/pipeline/`, the skills `/plan`, `/do`, `/flow`, `/ship`, `/board` in
`.claude/skills/` and the roles in `.claude/agents/` (copied from yokemate). Claude
Code loads the skills and roles when it starts in the engine root; the scripts act on
the installation they are run from and refuse any other working directory.

The cycle per task: `/plan` → the engineer reads the plan on derive → `/do`
→ automatic review and checks → PR → the engineer's manual check → `/ship`.
`/flow` runs that cycle for one or more tasks of one project, one task at a time,
asks the engineer at every decision and merges the tasks into one flow branch the
engineer checks as a whole. In this file «flow» alone is that run; the project's
flow is the project's branch and merge settings (`flow.json`, `mp-task flow`).

## Places

- Installation root: the installed engine checkout, never edited, with `home/` and
  `projects/` beside it. Every session's cwd; every path below is relative to it. The `mypi` CLI is `mise exec -- node dist/src/cli/main.js` there;
  `scripts/pipeline/mp-task` wraps it.
- Base clone: the project's `checkoutPath` from `scripts/pipeline/mp-task project <KEY>`
  (MP: `projects/yokeloop/mypi`), on the integration branch of the project's flow
  (`scripts/pipeline/mp-task flow <KEY>`; without `flow.json`: `origin/HEAD`, else `main`).
  The pipeline only fetches and fast-forwards it; never commit or switch there.
- Task worktree: `<checkoutPath>--<KEY>-<slug>`
  on the task branch of the flow (default `task/<KEY>-<slug>`). One writer per worktree. `scripts/pipeline/mp-worktree`
  creates it and installs dependencies only when it has a `pnpm-lock.yaml`.
- Project home: the `home` field of `mp-task project` (`home/projects/<org>/<slug>`).
  The clone path comes only from `checkoutPath`, the home only from `org/slug`; neither
  is derived from the other (TBA: clone `projects/TB-FF/tbff-automations`, home
  `home/projects/tb-ff/tbff-automations`).
- Task folder in mypi home (its own Git repository, direct `main`):
  `<project home>/tasks/<KEY>-<slug>/`
  (`requests/` until `mypi home migrate-tasks` has run on this home — T14 (MP-45);
  `scripts/pipeline/mp-task dir <KEY>` prints the actual folder). Every file of
  the folder may be edited. `task progress … <files>` commits the named files in
  home and records each as `{path, commit}`: the entry always reads the version it
  registered (`mypi context read <path> --revision <commit>`). Registered directly:
  `plan.md` (`/plan`); `plan.md`, `pr.md`, `do-report.json`, `review-report.json`
  (`/do`); `pr.md`, `progress.md` (`/ship`). A card is corrected by editing
  `source.md` and running `mp-home-commit`. The
  `plan-v<N>.md`, `*-final.md` and `addendum.md` files of earlier tasks remain
  history and are no longer created. After every write:
  `scripts/pipeline/mp-home-commit <KEY|CODE> "<message>"` (the `requests`, `tasks`,
  `flows` and `batches` folders of that project).
- Flow score: `<project home>/flows/<name>.md`. The
  `batches/` scores of the former `/batch` stay as history.
- Derive: the general plan is the derive artifact a task card links, if any (the v2
  cards of MP link `b7wieok9`, https://draft.yokeloop.com/artifacts/mypi-v2-b7wieok9);
  every task plan is its own artifact, `short_id` and `url` in the task folder's
  `derive.json`.
- `scripts/pipeline/mp-task` subcommands: `scope` (session scope as JSON), `project`
  (project record as JSON: `code`, `project`, `checkoutPath`, `home`, `repository`;
  `repository` is `owner/name` from the project's `repository` field, null for
  `local`, else from the clone's `origin`; takes a CODE or a KEY), `show`, `dir`, `slug`, `source`, `status`, `progress`,
  `board` (board rows of a project as JSON lines; terminal statuses with `all`). Run
  it without arguments for usage.

## Session scope

Every session (the main chat, an organization chat, a project chat, a task chat) starts in the engine root
and sees the pipeline skills. Each of the five skills checks the session scope as its
Step 0.

The key: `scripts/pipeline/mp-task scope` prints `{"key", "project", "org", "codes", "source"}`.
`org` is the key when it is the slug of a registered organization with at least one
project, and `codes` the sorted codes of its projects; otherwise both are `null`. It
takes the `sessions` row with this conversation's agent and native id
(`CLAUDE_CODE_SESSION_ID`, else `PI_SESSION_ID`; it is set inside subagents too and
is the parent chat's id), else `MYPI_SCOPE` (set by `/open`), else `global`. This is
the order of `warmup` without an argument, except the live record by pid: through
`mise exec` the pid does not match, and `MYPI_SCOPE`, which `/open` sets to the same
key, takes its place. The subcommand only reads (`mypi sessions`); neither `warmup`
nor `inbox` is used for the check, because both mark events delivered.

The rule:

- `global`: `/plan`, `/do` and `/ship` take tasks of any project; `/flow` and
  `/ship flow/<name>` take the keys of one project.
- `O` (an organization): `/plan`, `/do` and `/ship` take keys whose code is in
  `codes`; `/flow` and `/ship flow/<name>` take the keys of one project from `codes`
  (the flow score lives in that project's home).
- `P` (any project): every typed key has the code `P`; a flow holds keys of `P`,
  `/ship flow/<name>` takes a flow of project `P`.
- `P-N`: `/plan` and `/do` only when every typed key equals `P-N`; `/ship` only when
  every typed argument equals `P-N`; `/flow` and `/ship flow/<name>` are refused.
- A typed argument that is not a key `CODE-N` (other than `flow/<name>` of `/ship`
  and the run name of `/flow`), a malformed session key (`project` and `org` are both
  `null` and the key is not `global`) or a non-zero exit of `mp-task scope`: refused.
- `/board`: in a session of project P or its task P-N — the board of P; a typed CODE
  must equal P. In an organization `O` — a typed CODE must be in `codes`; without a
  CODE the boards of all `codes`, one after another. In global — the typed CODE, MP
  by default. A malformed key, an unknown
  code or a non-zero exit of mp-task scope — refused.
- A non-zero exit of `mp-task scope`: refused, with its output.

A refusal prints its text and stops. Nothing runs before it except `mp-task scope`:
no `mp-task show/status/progress`, no `git fetch`, no `mp-worktree`, no
`mp-home-commit`, no derive calls, no subagents (`/board` also runs `mp-task project`
and `project list`). The texts (`<cmd>`, the typed
arguments and `<key>` substituted):

- `/board` with another project's code: `/board <CODE> is not allowed in session scope <key>; this chat shows the board of <P> only. Use /board here or /open global for another project.`
- `/board` in an organization with a code outside `codes`: `/board <CODE> is not allowed in session scope <key>; this chat shows the boards of <codes> only. Use /board here or /open global for another project.`
- `/board` with a malformed key: `The board cannot tell this session's project (scope <key>). Open the main chat with /open global.`
- `/board` with an unknown code: `Unknown project code <P>; registered codes: <codes>.`
- a changing skill with another project's key: `/<cmd> <args> is not allowed in session scope <key>; nothing was written. This chat runs tasks of <P> only; run it in that task's or project's chat (/open <CODE>) or in the main chat (/open global).`
  (`<CODE>` is the code of the typed key.) In a `P-N` chat append: ` This chat may run /plan P-N, /do P-N and /ship P-N only.`
- a changing skill in an organization with a key outside `codes`: `/<cmd> <args> is not allowed in session scope <key>; nothing was written. This chat runs tasks of <codes> only; run it in the main chat (/open global).`
- a changing skill with a malformed session key or a non-zero `mp-task scope`: `/<cmd> cannot tell this session's project (scope <key>); nothing was written. Run it in the main chat (/open global).`
- a changing skill with an argument that is not a key: `/<cmd>: <arg> is not a task key (CODE-N); nothing was written.`
- `/flow` in `global` with keys of several projects: `/flow <args> mixes projects <codes>; a flow holds tasks of one project; nothing was written.`

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
- `scripts/pipeline/mp-worktree` — its single mode delegates to `mypi task worktree`;
  it stays for the flow mode, the dirty check and `pnpm install`.
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
the lead asks the teammate to shut down. Under `/flow` it does so after the key is
recorded in the flow score.

What every executor prompt carries: the task key, the plan path, the worktree path,
the task folder path, the base branch, this file's path, and the rule that its
final message is exactly one JSON object per its definition.

## Statuses in mypi

`new → planning → in_progress → review → merged → done`, plus `blocked`.

- `planning`: `plan.md` written and published to derive; waiting for the engineer.
  Set by `/plan`.
- `in_progress`: `/do` started; the worktree exists.
- `review`: implementation finished, review clean, checks green, PR open (single
  mode) or merged into the flow branch (flow mode). Waiting for the engineer's
  manual check.
- `merged`: the PR is merged into the PR target by `/ship`.
- `done`: the engineer's word after the installed engine runs the change. The
  pipeline never sets it.
- `blocked`: the pipeline stopped on an open point; the reason names it.

Every status reason carries the relevant link: derive URL or PR URL.

## Approval semantics

- An approved plan is the engineer typing `/do <KEY>` or `/flow …`; under
  `/flow` the engineer's answers to the plan's forks are part of the approval. No
  other signal counts; a published plan queues nothing.
- Open comment threads on the plan artifact (`catch_up` with `comments: open`) are
  remarks. `/plan` reworks the plan and republishes, resolving each thread with
  `comment` and `set_state: resolved` and a reply saying what changed. `/do` refuses to start while a thread is open, unless typed with
  `--force`.

## Where /flow waits for the engineer

`/flow` decides nothing on its own: each point below is one `AskUserQuestion` in
the flow's chat (header ≤ 12 characters, 2–4 options, the recommendation first),
and the run waits for the answer. No retry, no bypass, no weakened check in its
place; `blocked` only when the engineer answers so.

- a dependency outside the run that is not `review`, `merged` or `done`;
- every fork of a plan, one question at a time;
- an edit of the lead to a plan beyond the plan-writer's output (or an explicit
  line in the report);
- `openPoints` of the executor only the engineer can answer;
- a review finding that needs a decision beyond the plan, findings still blocking
  after the second review round, a fix — of a finding or of advice — that would
  change the plan's agreed text or behaviour;
- red checks or CI the plan's scope cannot fix, or still red after three attempts;
  CI red only on the test budget with `fail 0` is reported with the measurements,
  never rerun in a loop;
- an exceeded budget, a change of scope, a new task found on the way;
- red checks on the assembled flow branch before the PR.

Cheap review advice inside the plan's scope is fixed by the executor, followed
by one more review round; other advice goes into `pr.md` and the PR. The order of
the tasks is announced with its reasoning before the start, not asked. A live
acceptance the plan names runs as part of the run, without a question; an
exceeded stand budget or a failure that needs a decision is a question.

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

- The flow comes from `scripts/pipeline/mp-task flow <KEY|CODE>` (`integration`,
  `taskBranch`, `prTarget`, `mergeMethod`). An invalid `flow.json` is refused: the
  skill prints the error and stops before any write.
- Single mode: base `origin/<integration>` of the project's clone; PR from the task
  branch → `<prTarget>` in the `repository` from `mp-task project` (`gh pr create --repo
  <repository>`), merged by `/ship` after the engineer's check.
- Flow mode: the keys of one project; base `flow/<name>` created in the project's
  clone from `origin/<integration>` and pushed, flow worktree
  `<checkoutPath>--flow-<name>`; each task branch merges `--no-ff` into
  `flow/<name>` right after its review, checks and live acceptance where its plan
  names one; one PR `flow/<name>` → `<prTarget>` at the end, also for one task.
  The engineer checks the flow branch. Tasks run strictly one at a time, in the
  order announced before the start.
- `/ship` merges with `gh pr merge --<mergeMethod>`.
- Commits: English, imperative, one concern, no code comments, no attribution
  trailers (the `task-executor` rule).
- Never force-push. Never delete a remote branch. Worktrees are removed only by
  `/ship`, after the merge is verified and the tree inspected.

## Hard rules

- A task of any project never edits the installed engine, its `AGENTS.md` or shipped
  resources. Never run migrations, bootstrap, release or restore, nor, for MP, the
  engine update: those are the engineer's separate authorizations (for MP, task T14
  of the plan). Under `/flow` too: no GitHub Release or other publication and no
  migration of the personal database without the engineer's separate permission.
- Record state in mypi (`status`, `progress` with artifacts) and in the task
  folder; commit home after each change. Artifacts are the task folder's files
  named in `progress`; each entry points at the home commit `progress` made. Never
  rewrite or force-push home history: the references live in it. A repeated `status` with the
  same value writes nothing to the journal, so a rework reason goes into
  `progress`.
- A stage is passed by its named condition with the command output as evidence,
  never by "looks done". A check still red after three fix attempts is an open
  point, not a fourth attempt. Never a weakened check.
