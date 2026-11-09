# mypi task pipeline

Tooling for running the tasks of any registered project from the engine root; every
session starts there, so each pipeline skill checks the session scope first (see
«Session scope»). It is tracked in the engine repository: this file, `docs/PLAN-FORMAT.md`, the scripts in
`scripts/pipeline/`, the skills `/plan`, `/do`, `/epic`, `/flow`, `/ship`, `/board` in
`.claude/skills/` and the roles in `.claude/agents/` (copied from yokemate; `plan-challenger` is the pipeline's own). For Pi, the roles and workflow templates in `integrations/pi-flow/`,
found through `.pi/settings.json` («Roles»), and the Pi `/flow` skill
`integrations/skills/flow/SKILL.md` («Pi»). Claude
Code loads the skills and roles when it starts in the engine root; the scripts act on
the installation they are run from and refuse any other working directory.

The cycle per task: `/plan` → the engineer reads the plan on derive → `/do`
→ automatic review and checks → PR → the engineer's manual check → `/ship`.
`/flow` runs that cycle for one or more tasks of one project, one task at a time,
asks the engineer at every decision and merges the tasks into one flow branch the
engineer checks as a whole. An epic goes `/epic <KEY>` → `/flow <name> <KEY>` → `/ship flow/<name>` («Epics»). In this file «flow» alone is that run; the project's
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
  `plan.md` (`/plan`); `research.md`, `research-derive.json`, `challenge-report.json` (`/epic`); `plan.md`, `pr.md`, `do-report.json`, `review-report.json`
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
and sees the pipeline skills. Each of the six skills checks the session scope as its
Step 0.

The key: `scripts/pipeline/mp-task scope` prints `{"key", "project", "org", "codes", "source"}`.
`org` is the key when it is the slug of a registered organization with at least one
project, and `codes` the sorted codes of its projects; otherwise both are `null`. It
takes the `sessions` row with this conversation's agent and native id
(`CLAUDE_CODE_SESSION_ID`, else `PI_SESSION_ID`), else `MYPI_SCOPE` (set by
`/open`), else `global`. Inside a Claude Code subagent `CLAUDE_CODE_SESSION_ID` is
the parent chat's id. Inside a pi-subagents child `PI_SESSION_ID` is the child's
own id, which has no `sessions` row, so a child's scope falls back to
`MYPI_SCOPE`, then `global`; the Pi lead therefore names the key and the paths in
each role's task. This is
the order of `warmup` without an argument, except the live record by pid: through
`mise exec` the pid does not match, and `MYPI_SCOPE`, which `/open` sets to the same
key, takes its place. The subcommand only reads (`mypi sessions`); neither `warmup`
nor `inbox` is used for the check, because both mark events delivered.

The rule:

- `global`: `/plan`, `/do`, `/epic` and `/ship` take tasks of any project; `/flow` and
  `/ship flow/<name>` take the keys of one project.
- `O` (an organization): `/plan`, `/do`, `/epic` and `/ship` take keys whose code is in
  `codes`; `/flow` and `/ship flow/<name>` take the keys of one project from `codes`
  (the flow score lives in that project's home).
- `P` (any project): every typed key has the code `P`; a flow holds keys of `P`,
  `/ship flow/<name>` takes a flow of project `P`.
- `P-N`: `/plan`, `/do`, `/epic`, `/flow` and `/ship` take P-N and its subtasks — every task
  whose chain of parents reaches P-N (`mp-task subtasks P-N`); `/ship flow/<name>` —
  when every key of the flow score `<home of P>/flows/<name>.md` is P-N or its subtask.
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
and `project list`). In a `P-N` session `mp-task subtasks P-N` may run too, and for
`/ship flow/<name>` also `mp-task project P` and reading the flow score. The same holds for the Pi `/flow <name>` typed without keys, which resumes the
keys of that score. The texts (`<cmd>`, the typed
arguments and `<key>` substituted):

- `/board` with another project's code: `/board <CODE> is not allowed in session scope <key>; this chat shows the board of <P> only. Use /board here or /open global for another project.`
- `/board` in an organization with a code outside `codes`: `/board <CODE> is not allowed in session scope <key>; this chat shows the boards of <codes> only. Use /board here or /open global for another project.`
- `/board` with a malformed key: `The board cannot tell this session's project (scope <key>). Open the main chat with /open global.`
- `/board` with an unknown code: `Unknown project code <P>; registered codes: <codes>.`
- a changing skill with another project's key: `/<cmd> <args> is not allowed in session scope <key>; nothing was written. This chat runs tasks of <P> only; run it in that task's or project's chat (/open <CODE>) or in the main chat (/open global).`
  (`<CODE>` is the code of the typed key.) In a `P-N` chat append: ` This chat may run /plan, /do, /epic, /flow and /ship for P-N and its subtasks (<keys>|none) only.`
- a changing skill in an organization with a key outside `codes`: `/<cmd> <args> is not allowed in session scope <key>; nothing was written. This chat runs tasks of <codes> only; run it in the main chat (/open global).`
- a non-zero exit of `mp-task subtasks`: `/<cmd> cannot read the subtasks of <key>: <output>; nothing was written.`
- `/ship flow/<name>` in a `P-N` chat without the flow score: `/ship flow/<name>: no flow score <path>; nothing was written.`
- a changing skill with a malformed session key or a non-zero `mp-task scope`: `/<cmd> cannot tell this session's project (scope <key>); nothing was written. Run it in the main chat (/open global).`
- a changing skill with an argument that is not a key: `/<cmd>: <arg> is not a task key (CODE-N); nothing was written.`
- `/flow` in `global` with keys of several projects: `/flow <args> mixes projects <codes>; a flow holds tasks of one project; nothing was written.`

This is an instruction for the agent, not access control: the scripts still work
from any session.

## Subtasks

A task may name one parent task of the same project; the relation is stored in mypi
(`parent` of a task card), set with `mypi task create --parent <KEY>` and changed or
cleared with `mypi task parent <KEY> <parent-key|none> --reason …`. Subtasks form a
tree of any depth. `mp-task subtasks <KEY>` prints the recursive descendants of a
task as JSON lines, subtasks before their parent.

`/flow` expands every typed key into its subtasks and runs them in the same cycle
as the typed keys (`.claude/skills/flow/SKILL.md`; in Pi `integrations/skills/flow/SKILL.md`;
«Subtasks»). The status of a
subtask decides:

- `merged` or a terminal status: skipped, named in the announced order;
- `new`, `planning`, `in_progress`, or `review` with `pr.md` of this flow: runs
  like a typed key;
- `review` not of this flow: skipped, named; it has its own PR or flow already;
- `blocked` or any other non-terminal status (`research`, `paused`, a custom one):
  one `AskUserQuestion` (in Pi one `mypi_ask`) «include or skip». An included subtask gets
  `mp-task status <KEY> planning "в потоке <name>: включена инженером"` and goes on
  as `planning`;
- a typed key in `review` with subtasks and no `pr.md` of this flow is the epic:
  not scouted, planned or executed, its status unchanged by the run, named in
  the announced order and the flow score as «эпик — идут его подзадачи». When
  its `research.md` has `**Приёмка эпика:** да: <criterion>`, «Finish» of the
  flow skill runs one acceptance of the epic on the flow branch before the PR,
  `acceptance.md` in the epic's folder.

The order: subtasks before their parent, then the «Связи» dependencies and shared
files on top of it. While the flow runs a subtask that has a live tab of its own,
`/do` is not run in that tab (one writer per worktree); no code enforces it.
Milestones of subtasks whose status the epic's tab changes go, as always, to the
parent that last sent the subtask a message, else the project chat
(`src/app/task-work.ts`). The events of a task's session still go to the Parent
whose message started the turn, else the project chat.

## Epics

An epic is a task whose research proposes a mechanism and its subtasks.
`/epic <KEY>` (`.claude/skills/epic/SKILL.md`) leads steps 1–5 in the epic's chat:
research, independent check (`plan-challenger`), the engineer's decision on each
finding, version 2, subtasks. `/flow <name> <KEY>` runs steps 6–8 (the epic key
and the epic acceptance of «Subtasks» above), started by the engineer's answer in
`/epic` or typed; `/ship flow/<name>` merges. The step comes from the epic's status
and the files of its folder; there is no epic status, field or engine command.

`DIR` is `scripts/pipeline/mp-task dir <KEY>`; `N` —
`python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["findings"]))' $DIR/challenge-report.json`;
`ROWS` — `awk '/^## .*Решения по независимой проверке/,/^## Источники/' $DIR/research.md | grep -c '^| [0-9]'`;
`V` — `python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' $DIR/research-derive.json`.
The first row from the top whose sign holds is the step:

| Sign | Step | Next |
| --- | --- | --- |
| status `new`, no `research.md` | 1, not started | `/epic <KEY>`: research |
| `research.md`, no `research-derive.json` | 1, under way | `/epic <KEY>`: review, version 1 published |
| `research-derive.json`, no `challenge-report.json` | 2 | `/epic <KEY>`: independent check |
| `ROWS` < `N` | 3 | `/epic <KEY>`: a question on each remaining finding |
| `ROWS` = `N`, `V` = 1 | 4 | `/epic <KEY>`: version 2 |
| `V` ≥ 2, `mp-task subtasks <KEY>` empty | 5 | `/epic <KEY>`: the «Подзадачи» question |
| `mp-task subtasks <KEY>` not empty | 6–8 | `/flow <name> <KEY>`, then `/ship flow/<name>` |

Statuses of an epic: `new` while the research is written; `planning` with the
research URL once version 1 is published; `review` once the subtasks are
created; `done` is the engineer's word. An epic researched by `/plan` and `/do`
before `/epic` existed reads the same: the signs are files, not their author.

The research, `research.md`: Markdown with `mermaid`, in Russian; its header
paragraph names the version, the date and the full SHA of the clone's
`origin/<integration>` it was written on. The later steps read these sections,
so they are required; everything else is free:

- `## <n>. Итог`;
- `## <n>. Подзадачи`: the line `**Приёмка эпика:** да: <criterion>` or
  `нет: <reason>` — whether the epic as a whole is accepted on a stand and by
  what criterion; then each subtask in order as `### <N>. <title>` (after
  creation `### <N>. <KEY> — <title>`) with one-line fields `**Цель:**`,
  `**Файлы:**`, `**Документация и карта:**`, `**Зависимости:**`, `**Готово:**`,
  `**Проверки:**`, `**Стенд:**`;
- `## <n>. Решения по независимой проверке`: the table
  `| # | Находка | Тип | Решение инженера | Что изменилось |`, no rows in
  version 1, one row per finding of `challenge-report.json` added by `/epic`
  right after each answer, the last column and the line on where the subtasks
  of version 1 went filled by version 2; «Находок нет» when there are none;
- `## Источники`.

The epic's folder: `source.md`; `research.md`; `research-derive.json`
(`{"short_id","url","version","published_at"}`); `do-report.json` (the
`task-executor` teammate, which writes `research.md` in the folder: no worktree,
no commits, no diff); `review-report.json` (one `task-reviewer` round on
version 1); `challenge-report.json` (the `plan-challenger` answer, verbatim);
`acceptance.md` and its evidence (the epic acceptance, «Subtasks»). The journal gets one
`progress` per `/epic` run, at step 5, with `research.md`,
`research-derive.json` and `challenge-report.json`; the decisions live only in
the table.

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
plan), `task-investigator` (one question about existing behaviour, read-only),
`plan-challenger` (read-only independent check of a research document against the engineer's verbatim request; `/epic`).

The executor runs as an in-process **teammate** named by the key in lower case
(`mp-33`), spawned with `subagent_type: task-executor` and `name`. It stays alive
through the review loop, so reviewer findings go to it by `SendMessage` and it fixes
in the same context. Reviewer, investigator and challenger are ordinary subagents: fresh
context every time, never the lead's conclusions. When a task reaches `review`
the lead asks the teammate to shut down. Under `/flow` it does so after the key is
recorded in the flow score.

What every executor prompt carries: the task key, the plan path, the worktree path,
the task folder path, the base branch, this file's path, and the rule that its
final message is exactly one JSON object per its definition. Under `/epic` the epic's folder and the clone's SHA take the place of the worktree and the base branch («Epics»).

Pi's roles live in `integrations/pi-flow/`: `scout`, `planner`, `executor`,
`reviewer`, `tester`, `investigator`, `challenger`, each a `*.md` file whose
answer schema is its `outputSchema`, beside the workflow templates `standard.js`
(implement, review, fix through `resume`, at most two review rounds),
`parallel.js` (the same chain for several worktrees at once) and `investigate.js`
(read-only fan-out of scouts or investigators). `.pi/settings.json` makes
pi-subagents scan `integrations/pi-flow` and `home/pi-flow` (the engineer's own
roles and templates) and starts children without ambient extensions. The bodies
follow the Claude roles above without their defects: the executor reports the
worktree's real branch name and separates `openQuestions` from `deviations`, each
check with its expected exit code; the planner saves `plan.md` in the task's
folder and writes the plan's «Execution» section. File formats, own roles and
model tiers: `docs/agents/agent-integration.md`.

## Pi

Pi runs `/flow` from `integrations/skills/flow/SKILL.md`; it is Pi-only and keeps
the rules of the Claude skill with these bindings:

| Claude | Pi |
| --- | --- |
| the skill `.claude/skills/flow` | the extension command `/flow`, which sends `/skill:flow <args>` |
| `AskUserQuestion` | the extension tool `mypi_ask`: `question` and 2–4 `options`, the recommended one first; the tool marks it «(рекомендую)» and adds «Своё слово» |
| the `plan` skill with `plan-scout` and `plan-writer` | `subagent`: `integrations/pi-flow/investigate.js` with `scout`, then `planner` |
| the derive MCP tools | `mcp__derive__*` through codemode; the upload by `curl` |
| `CLAUDE_CODE_SESSION_ID` for `mp-task scope` | `PI_SESSION_ID`, exported by Pi's bash |
| re-typing the command | the same; `/flow <name>` without keys in a project or task chat resumes the keys of the flow score |

The run's state is the flow score, the task statuses and the task folders, so a
restarted Pi continues where it stopped: no `plan.md` — reconnaissance and plan;
`plan.md` without `derive.json` — publication; `derive.json` without the line
` — план v<version> согласован` on the key in the score — the «Согласовать /
Правки» question; with it — the plan is agreed. «Правки» or an own word sends the
plan back to `planner` with the remarks and the open derive threads, publishes a new
version of the same artifact and asks again. The answers go to the key's
`progress.md`. A cancelled `mypi_ask` stops the run without another write.
Execution after the agreement is not part of the Pi skill yet: the run stops with
«план <KEY> согласован».

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

## Journal

One writer per fact; nothing is written twice.

- The engine writes the facts it knows, once, at the moment they happen, inside
  the application command, so every entry point (CLI, MCP, HTTP API, `/open`)
  leaves the same entry. The types are `EVENT_TYPES` in
  `src/modules/knowledge/model.ts`; their texts:
  - `task_created` (task scope): `Task registered.`, with ` Parent: <KEY>.` when
    the task has a parent;
  - `status_changed` (task): `<before> → <after>. <reason>`. A repeated status
    changes nothing on the card but leaves a `note` `<status> (unchanged).
    <reason>`, so a rework reason goes into that status call; a repeated title
    writes nothing;
  - `title_changed` (task): `Title: "<before>" → "<after>". <reason>`;
  - `worktree_created` (task): `worktree <path>, branch <branch>, base
    <integration>`, by `task worktree` when it creates the worktree (the single
    mode of `mp-worktree`; the flow mode calls git itself and leaves no entry);
  - `session_opened` (task, project or organization): `started <agent>` or
    `resumed <agent>`, with `, worktree <path>` for a task; nothing on focus;
  - `message_sent` (the recipient's scope): `message <id> from <from>: <first
    line>`;
  - `clone_prepared` (project): `clone prepared: <action> <path>`, with ` from
    <repository>` when cloned;
  - `note`: everything else — `progress`, `task parent`, the repeated-status
    note above and the `journal` kind of the `note` tool.
  A skill never repeats these facts in a status reason or a `progress` text: no
  worktree path, no branch, no session, no parent message.
- A skill writes what only it knows — the outcome of a step and its link — as
  one `progress` entry (`mp-task progress`: a `note` with the step's files as
  artifacts) at its «Record» step: `/plan` the published plan (`plan.md`), `/do`
  the PR or the flow merge (`plan.md`, `pr.md`, `do-report.json`,
  `review-report.json`), `/ship` the merge (`pr.md`, `progress.md`), `/epic` the checked research and its subtasks (`research.md`, `research-derive.json`, `challenge-report.json`). Every
  status reason carries the relevant link («Statuses in mypi»); a reason set by
  `/flow` itself or by `/do` stage 1 in flow mode starts with `в потоке <name>`.
  `/flow` writes no `progress` of its own: its record is the flow score.
- The project chat, or the organization chat for a project of its organization,
  writes one `note` in the project scope (`note` kind `journal`, scope
  `{"type":"project","key":"<CODE>"}`) per release, engine update or decision
  taken in conversation: what was decided or shipped, the task keys and the key
  of the session it was decided in; the entry's time is its timestamp. The
  per-task `merged → done` line stays per task, with only the version in its
  reason. Never a copy of a task's entries in the project journal
  (`docs/M1-CLI.md`, «Journal filters»).
- Not journaled: events (`turn_end`, `waiting`, milestones), `/open` of a live
  session (focus), `inbox` and `warmup` reads, knowledge entries and context notes (home's
  Git is their history), and the conversation itself.

## Approval semantics

- An approved plan is the engineer typing `/do <KEY>` or `/flow …`; under
  `/flow` the engineer's answers to the plan's forks are part of the approval. No
  other signal counts; a published plan queues nothing.
- In the Pi `/flow` the plan of a key is agreed by the engineer's answer
  «Согласовать» to its `mypi_ask` question, recorded on the key's line of the flow
  score with the plan's version («Pi»); the typed `/flow` alone does not agree a
  plan there.
- Typing `/epic <KEY>` authorizes the research, its publication on derive and,
  after the engineer's answer to the «Подзадачи» question, `mypi task create
  --parent <KEY>` for the agreed subtasks. The answer «Завести и запустить /flow»
  in the epic's chat equals typing `/flow <name> <KEY>`; `/ship` runs only when
  typed. A parent message is never an answer to these questions.
- Open comment threads on the plan artifact (`catch_up` with `comments: open`) are
  remarks. `/plan` reworks the plan and republishes, resolving each thread with
  `comment` and `set_state: resolved` and a reply saying what changed. `/do` refuses to start while a thread is open, unless typed with
  `--force`.

## Where /flow waits for the engineer

`/flow` decides nothing on its own: each point below is one `AskUserQuestion` (in Pi one
`mypi_ask`, «Pi») in
the flow's chat (header ≤ 12 characters, 2–4 options, the recommendation first),
and the run waits for the answer. No retry, no bypass, no weakened check in its
place; `blocked` only when the engineer answers so.

- a dependency outside the run that is not `review`, `merged` or `done`;
- every fork of a plan, one question at a time;
- in Pi, every published plan: «Согласовать» or «Правки»;
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
- a subtask in `blocked` or another status that is not taken as it is (include or
  skip);
- a cycle between the subtask tree and the «Связи» dependencies (the tree's order,
  or stop);
- red checks on the assembled flow branch before the PR.

Cheap review advice inside the plan's scope is fixed by the executor, followed
by one more review round; other advice goes into `pr.md` and the PR. The order of
the tasks is announced with its reasoning before the start, not asked. A live
acceptance the plan names runs as part of the run, without a question,
and so does the epic acceptance the epic's research names («Finish» of the flow
skill, before the PR); an exceeded stand budget or a failure that needs a
decision is a question.

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
  folder by «Journal» above; commit home after each change. Artifacts are the
  task folder's files named in `progress`; each entry points at the home commit
  `progress` made. Never rewrite or force-push home history: the references live
  in it.
- A stage is passed by its named condition with the command output as evidence,
  never by "looks done". A check still red after three fix attempts is an open
  point, not a fourth attempt. Never a weakened check.
