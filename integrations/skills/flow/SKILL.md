---
name: flow
description: 'Pi only. Run one or more tasks of one registered project from the typed command to the merge and the release, one key at a time — session scope, subtasks, order, flow branch and score, reconnaissance by the scout role, the plan by the planner role on derive with «Согласовать / Правки», execution by the workflow template of the plan, review rounds, checks, the merge into the flow branch, the self-test by the tester role, the PR, the stand for the engineer and «Одобрить / Замечания / Стоп»; «Одобрить» merges the PR and runs the release procedure of the project. Every question goes through mypi_ask. Runs only when typed: "/flow <name> <KEY> [<KEY>…]", or "/flow <name>" in a project or task chat to resume.'
---

# /flow in Pi — tasks of one project from the typed command to the merge and the release

Read `docs/PIPELINE.md` in the engine root first: «Pi» binds the Claude pipeline to
Pi's tools, «Where /flow waits for the engineer» lists every stop of this skill. This
is the Pi counterpart of Claude's `.claude/skills/flow/SKILL.md` and keeps its rules
unless it says otherwise. Work inline in this chat: questions reach the engineer only
from here, through the `mypi_ask` tool; roles started with `subagent` cannot ask the
engineer. The typed command approves the run; the plan of each key is agreed by the
engineer's answer «Согласовать», the merge of the flow PR and the release by the
answer «Одобрить» («Approval semantics» of `docs/PIPELINE.md`).
`BIN=scripts/pipeline`; run every script with bash from the engine root (this
session's working directory).

«Flow» in this skill is the run. The project's flow (`flow.json`,
`$BIN/mp-task flow`) is the project's branch and merge settings, which the run reads.

## Tools

- Scripts: `$BIN/mp-task …` and `$BIN/mp-home-commit …` through bash. Bash exports
  this session's `PI_SESSION_ID`, so `$BIN/mp-task scope` reads this chat's scope.
- Roles: the `subagent` tool. It is enabled lazily: when `subagent` is not
  available, call `subagents_enable` first. Call `subagent` with its default options
  and without `async: true`, and wait for its result; never rely on `bg_wait` for a
  background child, it may return at once with «No active async runs». A role that
  asks the lead with `contact_supervisor` stays `running` and wakes this chat with
  `subagent_supervisor_request`: answer it with `subagent_supervisor` from the
  plan, the card and the engineer's answers, or ask the engineer through `mypi_ask`
  first. A role's own `PI_SESSION_ID` has no scope: every role's task names the key
  and the paths. In an interactive session a workflow run goes to the background and
  wakes this chat when it ends; its full return value is `workflow.value` in the
  `status.json` the completion notice names (`subagent({ action: "status", id: "<run
  id>" })` shows the path too). A finished role is continued with `subagent({ action:
  "resume", id: "<run id>", message })`: a background run that wakes this chat and
  returns a new run id; the next resume uses the newest.
- Derive: the `derive` MCP server through codemode — `tools.mcp__derive__stage`,
  `tools.mcp__derive__organize`, `tools.mcp__derive__catch_up`,
  `tools.mcp__derive__comment`, each awaited. The upload goes through bash with
  `curl`. Roles have no MCP: every derive call and every mypi write is the lead's.
- GitHub: `gh` through bash, for the PR, its checks and its merge.
- Questions: `mypi_ask` («Questions»).
- Time: every `<YYYY-MM-DD HH:MM>` and `<YYYY-MM-DD>` of this skill is the output of
  `date '+%Y-%m-%d %H:%M'` (or `date +%F`) run through bash right before the write
  that carries it; never a time typed by hand or guessed.

## Step 0 — session scope

`$BIN/mp-task scope`, then apply the «Session scope» rule of `docs/PIPELINE.md` to
`/flow`: `global` — continue when every key has the same code (keys of several
projects get the «mixes projects» text); an organization (`org` is not `null`) —
continue when every key has the same code and that code is in `codes`; `P` —
continue when every key has the code `P`; `P-N` — continue when every key is `P-N`
or its subtask by `$BIN/mp-task subtasks P-N`; an argument that is not a key (other
than the run name), a malformed session key or a non-zero exit — refused. A refusal
prints its text from `docs/PIPELINE.md` and stops.

`/flow <name>` without keys resumes: only when the scope's `project` is not `null`
(a `P` or `P-N` chat), `$BIN/mp-task project <project>` gives `home`, and the flow
score `<home>/flows/<name>.md` exists; its `- Command:` line gives the keys, and the
rule above applies to them. Otherwise print `usage: /flow <name> <KEY> [<KEY>…];
/flow <name> resumes only in a project or task chat that has the flow score` and
stop.

This step runs before «Preconditions», before `git fetch`, before the flow branch
is created or pushed and before the flow score is written.

## Preconditions

- The first argument is the run name `<name>`, not a task key; at least one key
  follows, or the score gives them (Step 0). Otherwise print
  `usage: /flow <name> <KEY> [<KEY>…]` and stop.
- Every key exists and is `new`, `planning`, `in_progress` (resume) or `review`
  (already merged into this flow — skipped; or the epic of «Subtasks»: a typed key
  in `review` whose `$BIN/mp-task subtasks <KEY>` is not empty and that has no
  `pr.md` naming this flow), or `merged` when the flow score has a `- Смержено:`
  line (a resume before the release). Anything else → stop before starting.
- `$BIN/mp-task project <first KEY>` gives `checkoutPath`, `home` and `repository`;
  `checkoutPath` or `repository` `null` → say so and stop.
- `$BIN/mp-task flow <first KEY>` gives the project's `integration` and `prTarget`;
  a non-zero exit → print its error and stop before any write.

## Subtasks

Before the flow score is written, run `$BIN/mp-task subtasks <KEY>` for every typed
key. The run list: for each typed key, in the typed order, its descendants in the
order of the `subtasks` output, then the key itself; a repeated key is dropped and
its first occurrence stays. The status of each subtask decides by «Subtasks» of
`docs/PIPELINE.md`: skipped, taken like a typed key, or one `mypi_ask` — question
`Подзадача <KEY> «<title>» в статусе <status>: <reason from $BIN/mp-task show
<KEY>>. Пропустить — поток идёт без неё; включить — она планируется в потоке
<name>.`, options `Пропустить`, `Включить`. An included subtask gets
`$BIN/mp-task status <KEY> planning "в потоке <name>: включена инженером"`.

A typed key in `review` that has subtasks and no `pr.md` naming this flow is the
epic: it is not scouted, planned or recorded, and the run never changes its status;
the announced order and the skipped list of the flow score name it `<KEY> — эпик,
идут его подзадачи`.

On resume a key already in the score's «Order» or «Skipped» keeps its place and is
not asked about again; only a subtask that is in neither is decided as above.

## Order

Before any write, compute the order of the keys. The base is the run list (subtasks
before their parent). Then the dependencies from the «Связи» section of each
`source.md` (a key goes after the keys of this run it depends on): a stable
topological reordering that never puts a parent before its subtasks. Then the files
each card names — tasks touching the same files go one after another, the one the
others build on first — where those constraints allow it. A cycle between the tree
and «Связи» is one `mypi_ask` with the cycle in the question, options
`Порядок дерева подзадач`, `Остановить`. Announce the order in the chat: the keys in
order, a mark `подзадача <parent>` on each subtask, one line of reasoning per key,
then on a line of its own the skipped subtasks with their status. Then go on without
waiting for a confirmation. A dependency outside the run that is not `review`,
`merged` or `done` is one `mypi_ask` before the start with the dependency and its
status in the question, options `Остановить и ждать`, `Продолжить с пометкой`; the
second answer is recorded in the key's `progress.md`, as `/do --force` records it.

On resume the order of the score stands: print it with the stage of each key
(«Per key»), no new announcement.

## Flow branch

`<base clone>` is the project's `<checkoutPath>`.

1. `git -C <base clone> fetch -q origin`. If `origin/flow/<name>` does not exist:
   `git -C <base clone> branch flow/<name> origin/<integration> && git -C <base
   clone> push -u origin flow/<name>`.
2. Flow worktree: `<checkoutPath>--flow-<name>` on `flow/<name>`
   (`git -C <base clone> worktree add <path> flow/<name>` when missing); then
   `git -C <flow worktree> merge -q --ff-only origin/flow/<name>`. Never work in the
   base clone.
3. Flow score `<project home>/flows/<name>.md`, written once (on resume it is reused
   as it is):

   ```
   # Flow <name>

   - Command: `/flow <name> <KEY> [<KEY>…]` (the typed keys)
   - Branch: `flow/<name>`, base `origin/<integration>` <SHA>
   - Worktree: `<flow worktree>`
   - Started: <YYYY-MM-DD>, Pi

   ## Order

   - [ ] <KEY> — <title>[ (подзадача <parent>)]

   ## Skipped

   - <KEY> — <status or «эпик, идут его подзадачи»>[; ответ инженера: <answer>]

   ## Answers

   - <question in one line> → <answer>
   ```

   «Answers» holds the answers that belong to no key (a cycle of the order).
   Commit with `$BIN/mp-home-commit <CODE> "flow <name>: start"` (it stages `flows`
   too).

## Reconnaissance up front

The keys that need a plan are those whose task folder (`$BIN/mp-task dir <KEY>`) has
no `plan.md`. Their scouts run at once, in parallel, in one call:

`subagent({ workflow: "integrations/pi-flow/investigate.js", args: { items: [{ key: "<key in lower case>", agent: "scout", task: "<scout task>" }, …] } })`

The scout task carries, as text: the key, the full `source.md` (`$BIN/mp-task source
<KEY>`), the remarks if any, the project `<org>/<slug>`, the clone path — the flow
worktree, the project's folder in home, `.yoke/` and `AGENTS.md` (else `CLAUDE.md`)
of the clone when they exist, and the project's checks by «Checks» of
`docs/PIPELINE.md` (MP: `pnpm build` and `pnpm verify`); when the project's
instructions name no checks, the scout reports that as a fact. Before the call, note
per key the SHA `git -C <base clone> rev-parse origin/flow/<name>` and append
` — разведка <SHA>` to the key's line in the score. An item with `ok: false` or
`answer: null` is one `mypi_ask` with the error, options `Повторить разведку`,
`Остановить`; «Повторить разведку» runs `subagent({ agent: "scout", task })` for
that key. `solvable: false` is one `mypi_ask` with `missing` in the question,
options `Остановить (blocked)`, `Остановить`: the first sets
`$BIN/mp-task status <KEY> blocked "в потоке <name>: <missing>"`, both stop the run.
Questions and plans still go one key at a time.

## Per key, in the announced order

Strictly one key at a time. For each key:

1. Skip if the key's line in the score is ticked (`- [x]`), or if the key is the
   epic («Subtasks»).
2. **Stage.** Decide by the task folder and the score, without asking:
   - the line's last mark is ` — замечания` → the rework of step 6 («With remarks»)
     with the remarks of the last `замечания приёмки` lines of the key's
     `progress.md`;
   - no `plan.md` → step 3 with the key's scout answer; when this run has none,
     run `subagent({ agent: "scout", task })` for the key first, as in
     «Reconnaissance up front»;
   - `plan.md` without `derive.json` → step 5;
   - `derive.json`, and the key's line in the score has no ` — план v<version>
     согласован` with the version of `derive.json` → step 6;
   - that mark is there → «Execution of the key».
3. **Questions.** Each fork of the scout (`forks`) is one `mypi_ask`: `question` —
   `<KEY>: <fork question>` and the fork's `why`; `options` — the fork's options in
   their order (the recommended one first). The scout's `assumptions` go to the
   planner as they are; never ask about logs, extra checks, release or merging.
4. **Plan.** `subagent({ agent: "planner", task })`. The task carries: the key, the
   project `<org>/<slug>`, the task folder, the flow worktree as the clone, the
   scout's `facts`, `localization`, `simplestPath` and `assumptions`, every fork with
   the engineer's answer verbatim, the project's release procedure (`release` of
   `$BIN/mp-task flow <KEY>`; null — «none — merge only») and the project's stand
   document `<project home>/stand.md` when it exists (else «none»), the done criteria of `source.md` (they land in
   Acceptance as executable checks; when the project's instructions name no checks,
   Acceptance names concrete check commands that run in the worktree), and the rule
   for the first lines: the key and the title, then the general plan's URL when the
   card links one, otherwise a line saying there is no general plan. The answer
   `{ plan, questions }`: `plan: null` → each question is one `mypi_ask` (`options`
   and `why` as the planner gave them), then the planner runs again with every answer
   added. Read the plan: an open question left in it, or no «Execution» section, is
   a defect — send it back once with the decisions it missed; still defective → one
   `mypi_ask` with the defect, options `Остановить`, `Опубликовать как есть`. Never
   edit `plan.md` yourself.
5. **Publish** (fresh plan and rework alike):
   1. `await tools.mcp__derive__stage({ target: "doc" })`; on rework pass `short_id`
      from `derive.json` (a new version of the same artifact).
   2. Upload through bash: `curl -sS -F file=@<task folder>/plan.md -F title="<KEY> —
      план: <task title>" -F message="<what changed>" <upload_url>`; `message` only
      on rework, naming what changed for each remark. Take `short_id`, `url` and the
      version number from the answer.
   3. Fresh plan: `tools.mcp__derive__organize({ short_ids: [<short_id>], set:
      ["<slug>", "<CODE>", "plan"] })` (`<slug>` is the project slug).
   4. Rework: resolve every thread of the remarks with `tools.mcp__derive__comment({
      short_id, reply_to: <thread id>, set_state: "resolved", body: "<one line: what
      changed in the plan>" })`.
   5. Write `derive.json` `{"short_id","url","version","published_at"}` in the task
      folder.
   6. Record by «Journal» of `docs/PIPELINE.md`:
      `$BIN/mp-task progress <KEY> "План v<version> опубликован: <url>" plan.md`;
      fresh: `$BIN/mp-task status <KEY> planning "план опубликован, ждёт
      согласования: <url>"`; rework: `$BIN/mp-task status <KEY> planning "план
      v<version> переработан: <что изменилось>; ждёт согласования: <url>"`;
      `$BIN/mp-home-commit <KEY> "<KEY>: plan v<version>"`.
6. **Agree.** `tools.mcp__derive__catch_up` with the `short_id` of `derive.json` and
   `comments: "open"` gives the open threads. One `mypi_ask`: question `<KEY>: план
   v<version> опубликован: <url>.` with the open threads quoted (or «Открытых
   замечаний в derive нет.»); options `Согласовать`, `Правки` — `Правки` first when
   a thread is open.
   - `Согласовать` → append ` — план v<version> согласован` to the key's line in the
     score; `$BIN/mp-home-commit <CODE> "flow <name>: <KEY> plan v<version>
     agreed"`; go to «Execution of the key».
   - `Правки` → the remarks are the open threads, each quoted verbatim; with no open
     thread say «открытых замечаний в derive нет» and ask step 6 again.
   - Own word (`custom: true`) → the remarks are that text and the open threads.
   With remarks: `subagent({ agent: "planner", task })` with the key, the task folder,
   the flow worktree, the path of the current `plan.md` and every remark verbatim —
   the planner revises `plan.md` in place so that each remark is addressed and keeps
   the rest; then step 5 as rework (resolving exactly those threads) and step 6
   again.

## Execution of the key

Strictly one key executes at a time. `<task folder>` is `$BIN/mp-task dir <KEY>`,
`<flow worktree>` and `<base clone>` are those of «Flow branch». The stage, decided
by the task folder without asking: the status is `review`, `pr.md` names this flow
and the line is not ticked → step 8; `do-report.json` exists → step 5; otherwise
step 1 — also for a key back from «Замечания», whose base check runs before the
template of step 3. An answer already recorded in the key's `progress.md` for this
key and this plan version is not asked again.

A key's plan URL — in its statuses, `pr.md`, the PR body and every question — is
`url` of its `derive.json`, read from the file each time; never a URL written from
memory or made up.

1. **Base check.** `git -C <base clone> fetch -q origin`, then
   `git -C <base clone> log --stat <from>..origin/flow/<name>`. `<from>` is the SHA
   of the last ` — разведка <SHA>` or ` — смержено <SHA>` mark of the key's line,
   whichever comes later: for a key back from «Замечания» that is its own last flow
   merge, so only the changes of other keys count (no such mark — skip the check
   and name that in the final report). When the log touches a file `plan.md` names: run
   `subagent({ agent: "scout", task })` for the key with that log in its task, then
   the planner revises `plan.md` with the new facts as one remark («база потока
   изменилась: <files>»), step 5 of «Per key» as rework and step 6; after
   «Согласовать» append ` — разведка <new SHA>` to the line and come back here.
2. **Worktree.** `$BIN/mp-worktree <KEY> --base flow/<name>` prints `worktree`,
   `branch`, `base_ref`, `base` and `dirty`. An `error` → a key stop question with
   the literal output. `dirty: true` → one `mypi_ask` with `git -C <worktree>
   status --short`, options `Остановить (blocked)`, `Остановить`, `Продолжить с этим
   состоянием`. Then `$BIN/mp-task status <KEY> in_progress "в потоке <name> по
   плану v<version>: <url>"` (`version` and `url` of `derive.json`) and
   `$BIN/mp-home-commit <KEY> "<KEY>: execution started"`. When the plan's
   «Execution» names `parallel.js`, each part gets
   `git -C <base clone> worktree add -q -b <branch>--<part> <worktree>--<part> <base>`
   when that path is missing.
3. **Run** by the plan's «Execution»:
   - `standard.js`: `subagent({ workflow: "<template path>", args: { key: "<KEY>",
     plan: "<task folder>/plan.md", worktree: "<worktree>", taskDir: "<task
     folder>", base: "<base_ref>", executor: "<the plan's role>", reviewer: "<the
     plan's reviewer role, else reviewer>" } })`;
   - `parallel.js`: `args: { parts: [{ key: "<part>", agent: "<the part's role>",
     plan, worktree: "<worktree>--<part>", taskDir, base: "<base_ref>" }, …],
     reviewer }`, the parts in the plan's order;
   - another template of `home/pi-flow/`: the `args` its header names, from the
     same values;
   - no template (the order in words): write the order as a workflow script
     `<task folder>/workflow.js` — a header comment as in
     `integrations/pi-flow/standard.js`, one `runs.run` per run in the plan's order,
     the return shape of `standard.js` — and run it the same way.
   The args come only from these values, so a run started again after a restart
   gets the same args. While the run is in the background, take the next keys in
   order whose plan is not agreed through steps 2–6 of «Per key»: never their
   execution, never a write in this key's worktree. When the run ends, finish the
   step in progress (an open `mypi_ask` is answered first) and go on here.
4. **Reports**, from the run's full return value, right after it returns and
   before any decision: `do-report.json` — the executor's newest report (the last
   `fixes[].report`, else `executor.report`; for parts an object keyed by part);
   `review-report.json` — `{ "rounds": [ { "round", "range", "status",
   "findings", "outsidePlan" } ] }` from `reviews` (for parts each round also has
   `part`), every finding with `resolution`: `fixed <SHA>` (the head of the fix
   that resolved it), `pr.md` (advice left to the PR), `engineer: <answer>`, or
   `open` until it is decided. Rewrite both files after every later fix and round.
   Check the file with
   `python3 -c 'import json,sys;r=json.load(open(sys.argv[1]))["rounds"];assert r and all({"round","range","status","findings","outsidePlan"}<=x.keys() and all("resolution" in f for f in x["findings"]) for x in r)' <task folder>/review-report.json`;
   a non-zero exit is your own defect: rewrite the file and check again.
5. **Decide**, on the newest round, in this order:
   1. A failed run — the workflow failed, `executor.report` is null, a fix has
      `ok: false`, a round has `status: null` → a key stop question with the
      literal error.
   2. `openQuestions` of the executor: a question the code answers →
      `subagent({ agent: "investigator", task })`; any other → one `mypi_ask`
      each. The answers go to the executor by resume, then one review round.
   3. `outsidePlan` not empty → `git -C <worktree> diff --name-only
      <base>..<head>`: a listed file that is in this diff and whose path
      `plan.md` does not name is outside the plan, a lockfile too; files already
      answered for this key are not asked again; none left — go on as if the list
      were empty. Otherwise one `mypi_ask` for all of them: question `<KEY>:
      файлы вне плана: <files>. Убрать — исполнитель вернёт их к базе, затем ещё
      один раунд ревью; Оставить — файлы остаются, ответ записан в progress.md.`,
      options `Убрать`, `Оставить`. «Убрать» → the executor by resume restores
      those files to `<base>` and commits, with the round's blocking findings in
      the same message; then one review round. «Оставить» → the round's blocking
      findings, if any, by resume, then one review round.
   4. `changes_required` after the second round or a later one → one `mypi_ask`
      with the blocking findings verbatim, options `Остановить (blocked)`, `Ещё
      один раунд исправлений`; the second → the findings by resume, one review
      round, this rule again. A finding whose fix would change the plan's agreed
      text or behaviour → one `mypi_ask` with the finding, options `Оставить по
      плану`, `Исправить по находке`.
   5. `approved`: each advice finding that is a cheap fix inside the files and
      steps of the plan goes to the executor by resume, followed by one more review
      round; every other advice keeps `resolution: pr.md`.
   «By resume» is `subagent({ action: "resume", id: "<newest executor run id>",
   message })`, the message carrying the findings, answers or output verbatim and
   «fix them in the worktree, commit, and answer again with your whole report»;
   its report becomes `do-report.json`. A refused resume (the executor is no
   longer retained) → `subagent({ agent: "<the plan's role>", task })` with the
   template's context and the message; the final report names the fallback. «One
   review round» is a fresh `subagent({ agent: "<reviewer role>", task: "Task
   <KEY>. Plan: <plan>. Worktree: <worktree>. Task folder: <task folder>. Base
   branch: <base_ref>. Review the diff <base>..<head> in the worktree against the
   plan." })`, added to `review-report.json` as the next round with its range.
6. **Checks**, by you only, in the worktree. Parts first: `git -C <worktree> merge
   --no-ff <branch>--<part> -m "Merge part <part> of <KEY>"` in the plan's order; a
   conflict → `git -C <worktree> merge --abort` and a key stop question with the
   literal output. When `plan.md` names a lockfile, first the project's install
   (MP: `mise exec -- pnpm install --frozen-lockfile`). Then the project's checks by
   «Checks» of `docs/PIPELINE.md` (MP: `mise exec -- pnpm build`, then `mise exec
   -- pnpm verify`; one verify on the machine; on `Unit mypi-tests already exists`
   or `already running` wait 60 s and retry, at most 5 times). Red → the literal
   output to the executor by resume (for parts, the part whose files the output
   names; unclear — a key stop question), then the checks again; after three
   attempts one `mypi_ask` with the literal output, options `Остановить
   (blocked)`, `Ещё попытка`. Keep the last output's tail for `pr.md`.
7. **Merge into the flow branch.** `git -C <worktree> push -u origin <branch>`;
   `git -C <flow worktree> merge --no-ff <branch> -m "Merge <KEY>: <title>"`;
   `git -C <flow worktree> push`, always before step 8: the stand clones the commit
   from origin. A conflict → `git -C <flow worktree> merge --abort` and a key stop
   question with the literal output; a failed push → a key stop question with the
   literal output. Write `pr.md` in the
   task folder: `# <KEY> — доставка (поток <name>)`, the flow merge SHA and the
   branch, the plan URL, the checks with their exit codes and the tail, the review
   rounds with what each fixed, open advice, the executor's `deviations`, the
   engineer's answers. Record by «Journal» of `docs/PIPELINE.md`:
   `$BIN/mp-task progress <KEY> "Реализовано, ревью чистое, проверки зелёные: <flow merge SHA>" plan.md pr.md do-report.json review-report.json`;
   `$BIN/mp-task status <KEY> review "в потоке <name>, слито <flow merge SHA>"`;
   `$BIN/mp-home-commit <KEY> "<KEY>: merged into flow/<name>"`.
8. **Self-test**, after the push of step 7 (`git -C <flow worktree> status -sb`
   shows no `ahead`), only when the plan's «Execution» names self-test items and a
   stand (not «none») and `<project home>/stand.md` exists:
   `subagent({ agent: "tester", task })` with the plan, the commit
   `git -C <flow worktree> rev-parse HEAD`, the stand document, the task folder,
   the self-test items and the budget of model turns the plan names (none named —
   40). `passed` → step 9, with a «Самотест» section appended to `pr.md`. Failed
   items inside the plan's scope → the items and their evidence to the executor by
   resume, one review round, step 6, step 7, then `tester` again with the failed
   items. A failure that needs a decision, `openQuestions`, or `turns` over the
   budget → one `mypi_ask` with the items, options `Остановить (blocked)`,
   `Принять результат`.
9. **Record.** Tick the key's line (`- [ ]` → `- [x]`) and append ` — смержено
   <flow merge SHA>, ревью <status of the newest round> (<rounds> р.), самотест
   <passed>/<total> | не требуется`; `$BIN/mp-home-commit <CODE> "flow <name>: <KEY>
   merged"`. The run writes no `progress` of its own. Then the next key; after the
   last one, «Finish».

## Finish

The flow lines of the score — `- PR:`, `- Стенд:`, `- Замечания:`, `- Стоп:`,
`- Одобрено:`, `- Смержено:`, `- Релиз начат:`, `- Релиз:` — go into its header
list, each right after the last line of that list (`- Started:` or the flow line
before it), never under «Order», «Skipped» or «Answers» and never at the end of the
file; each is committed by its own `mp-home-commit` as soon as it is written,
before the next step starts.
On resume, unticked keys go first by «Per key»; then the newest of these lines
decides: none → step 1 here; `- PR:` or `- Стоп:` → «The engineer's check» step 1;
`- Стенд:` → its step 2; `- Замечания:` → step 1 here; `- Одобрено:` → «Ship»;
`- Смержено:` → «Release»; `- Релиз начат:` → «Release» step 2; `- Релиз:` → the
report.

1. In the flow worktree: the project's checks by «Checks» of `docs/PIPELINE.md`
   (none named — the check commands of the plans of all keys except the epic, in
   order). Red → a flow stop question with the literal output; no PR before it is
   answered.
2. **Epic acceptance**, only when a typed key is the epic and
   `$($BIN/mp-task dir <EPIC>)/research.md` has the line `**Приёмка эпика:** да:
   <criterion>`. No `<project home>/stand.md` → one `mypi_ask`, options
   `Остановить`, `Пропустить приёмку эпика`. Otherwise
   `subagent({ agent: "tester", task })` with the criterion as its only item, the
   commit of the flow worktree's head, the stand document, the epic's folder as
   the task folder and a budget of 40 model turns; write `acceptance.md` in the
   epic's folder from its items; append `- Приёмка эпика: <passed>/<total>
   (<path of acceptance.md>)`; `$BIN/mp-home-commit <CODE> "flow <name>: <EPIC>
   acceptance"`. A failure inside a subtask's plan → that subtask's executor by
   resume (a fresh `executor` with its plan when it is not retained), one review
   round, the checks, a new `--no-ff` merge, step 1, the failed items again. A
   failure that needs a decision or an exceeded budget → one `mypi_ask`, options
   `Остановить`, `Принять результат`.
3. **PR.** `gh pr list --repo <repository> --head flow/<name> --state open --json
   url --jq '.[0].url // ""'`: a URL → that PR (the pushes have updated it);
   otherwise `gh pr create --repo <repository> --base <prTarget> --head
   flow/<name> --title "Flow <name>: <KEY>, <KEY>, …" --body "<body>"` — also for
   one key; the title lists every key of the run except the epic, in the order of
   the score (`Flow fx: FX-2, FX-3`), never the epic's key alone; the body
   listing per key the title, the plan URL, the review verdict, the checks, the
   self-test (or «not required») and the engineer's answers; one line for the epic
   acceptance (result and the path of `acceptance.md`, or «not required») when a
   typed key is the epic; the last line `Release after approval: <release>` or
   `Release: none — merge only`. No attribution line.
4. `gh pr checks <url> --watch`. Red only on the test budget with `fail 0` →
   name it with the measurements in the final report, no rerun, go on. Any other
   red → one `mypi_ask` with the literal output, options `Остановить`, `Проверить
   снова`.
5. For every key except the epic: `$BIN/mp-task status <KEY> review "в потоке
   <name>, ждёт ручной проверки: <PR url>"`. Append `- PR: <url>`;
   `$BIN/mp-home-commit <CODE> "flow <name>: PR"`.

## The engineer's check

1. **Stand**, only when `<project home>/stand.md` exists:
   `subagent({ agent: "tester", task })` with «handover», the plans of all keys
   except the epic, the commit of the flow worktree's head, the stand document and
   the folder `<project home>/flows/<name>/` for the checklist. `handover` null or
   a failure → a flow stop question with the literal answer. Append `- Стенд:
   <attach>; чек-лист <checklist>; снос: <teardown>`; `$BIN/mp-home-commit <CODE>
   "flow <name>: stand"`.
2. One `mypi_ask`: question `Поток <name>: PR <url>. Стенд: <attach>. Чек-лист:
   <checklist>.` (no stand document: `Поток <name>: PR <url>. Стенда нет: у проекта
   нет документа стенда.`) followed by `Одобрить — мерж PR методом <mergeMethod>,
   затем релиз по <release>` (or `затем релиза нет — только мерж`) `; Замечания —
   ключи, которых они касаются, возвращаются к правке плана и исполняются снова;
   Стоп — поток останавливается, /flow <name> спросит снова.`; options `Одобрить`,
   `Замечания`, `Стоп`. The answer goes to «Answers» of the score. Before acting on
   it, run the stand's `teardown` when a stand was built; a non-zero exit goes into
   the final report with its output.
   - `Одобрить` → append `- Одобрено: <YYYY-MM-DD HH:MM>`;
     `$BIN/mp-home-commit <CODE> "flow <name>: approved"`; «Ship».
   - `Замечания` or an own word → the remarks: the own word's text and the open
     threads (`tools.mcp__derive__catch_up`, `comments: "open"`) of each key's plan
     artifact. None → say «замечаний нет: напишите их своим словом или в derive на
     плане ключа» and go to step 1. Each remark belongs to the key it names (a
     thread — the key of its artifact; a text — the key, or the files of its plan,
     it names); a remark that names none → one `mypi_ask` with the remark, options
     up to four keys of the run whose plans' files it is closest to, closest first.
     Per touched key: append `- <YYYY-MM-DD HH:MM> замечания приёмки: <remark>` to
     its `progress.md` — only there: the remark texts never go into the flow score,
     whose «Answers» line for this question reads `→ Замечания: <keys>`; move
     `do-report.json` and `review-report.json` to
     `do-report-v<version>.json` and `review-report-v<version>.json` (`version` of
     `derive.json`); untick its line and append ` — замечания`. Append `-
     Замечания: <YYYY-MM-DD HH:MM>: <keys>`; `$BIN/mp-home-commit <CODE> "flow
     <name>: remarks"`. Then «Per key» for the touched keys in order (the rework of
     step 6, then «Execution of the key» on the same worktree and branch), then
     «Finish» and this section again.
   - `Стоп` → append `- Стоп: <YYYY-MM-DD HH:MM>`; `$BIN/mp-home-commit <CODE>
     "flow <name>: stopped"`; report `поток <name> остановлен на приёмке: <PR url>;
     /flow <name> спросит снова` and stop.

## Ship

The `/ship` procedure for `flow/<name>` (`.claude/skills/ship/SKILL.md`, steps
2–6), run by this skill after «Одобрить»:

1. `git -C <flow worktree> fetch -q origin`, `git -C <flow worktree> merge
   origin/<prTarget>`, never a rebase. Conflicts by the rule of `/ship` step 2:
   read the neighbour's merged PR and the plans, keep both intents, never
   `--ours`/`--theirs`; a hunk the plans cannot answer → one `mypi_ask` with the
   hunk, options `Остановить`, `Решить в пользу <prTarget>`. When the merge moved
   the head: the checks of «Finish» step 1 (red → a flow stop question). `git -C
   <flow worktree> push`.
2. `gh pr checks <url> --watch --fail-fast`; red → one `mypi_ask` with the literal
   output, options `Остановить`, `Проверить снова`.
3. `gh pr view <url> --json state --jq .state`: `MERGED` → no merge; otherwise
   `gh pr merge <url> --<mergeMethod>`. The merge SHA: `gh pr view <url> --json
   mergeCommit --jq .mergeCommit.oid`.
4. For every key except the epic, in order, unless it is already `merged`:
   `$BIN/mp-task status <KEY> merged "смержено в <prTarget>: <merge SHA>"`;
   `$BIN/mp-task progress <KEY> "Смержено: <PR url>" pr.md progress.md`.
5. Clean up each key's worktree and part worktrees, then the flow worktree:
   `git -C <wt> status --porcelain --ignored`; untracked files that are not build
   output move to the key's task folder (the flow worktree's to `<project
   home>/flows/<name>/`); `git -C <base clone> worktree remove <wt>`; `git -C <base
   clone> branch -d` for each task branch, part branch and `flow/<name>`. Remote
   branches stay. A refused `worktree remove` or `branch -d` is kept and named in
   the final report.
6. Append `- Смержено: <merge SHA> <YYYY-MM-DD HH:MM>`; `$BIN/mp-home-commit
   <CODE> "flow <name>: shipped"`.

## Release

1. `release` of `$BIN/mp-task flow <first KEY>`. Null → append `- Релиз: нет
   процедуры — только мерж`; `$BIN/mp-home-commit <CODE> "flow <name>: no
   release"`; the report.
2. Otherwise: a `- Релиз начат:` line without a later `- Релиз:` → one `mypi_ask`
   with the procedure and what its done criterion shows now, options `Остановить`,
   `Повторить релиз`. Else append `- Релиз начат: <YYYY-MM-DD HH:MM>, процедура
   <release>`; `$BIN/mp-home-commit <CODE> "flow <name>: release started"`, both
   before step 3.
3. `git -C <base clone> fetch -q origin`. The base clone must be on `<prTarget>`
   and clean (`git -C <base clone> status --porcelain` empty), then
   `git -C <base clone> merge -q --ff-only origin/<prTarget>`; anything else → a
   flow stop question with the literal output.
4. The procedure: a path → `git -C <base clone> show origin/<prTarget>:<release>`;
   an https URL → `curl -fsSL <release>`. Follow its steps in order in the base
   clone through bash, nothing the procedure does not say. A step that would
   commit, switch a branch or change tracked files of the base clone → a flow stop
   question with the step; a failed step → a flow stop question with the literal
   output.
5. Done → append `- Релиз: <what was published> <YYYY-MM-DD HH:MM>`; the project
   note by «Journal» of `docs/PIPELINE.md`: `mise exec -- node dist/src/cli/main.js
   journal add "Релиз <org>/<project>: <what>; поток <name>: <KEY>, …; сессия
   <scope key>" -s <org>/<project>`; `$BIN/mp-home-commit <CODE> "flow <name>:
   released"`.

## Report

The PR URL and the merge SHA; per key the review verdict and the self-test; the
epic acceptance; the release result or «релиза нет — только мерж»; what was
removed and what was kept; open advice; the engineer's answers; fallbacks and
skipped base checks; and «статусы — merged; done ставит инженер» (for MP also:
the installed engine is not updated by this run, `docs/agents/installation.md`).

## Questions

Every stop listed in «Where /flow waits for the engineer» of `docs/PIPELINE.md` and
every question of this skill is one `mypi_ask` call: `question` — the literal output
or finding and one line of reasoning per option; `options` — 2–4 short labels, the
recommended one first, without «(рекомендую)» and without «Своё слово» (the tool adds
both). Never ask in plain chat text and never two questions in one call. The run
waits for the answer; no retry, no bypass, no weakened check in its place.

A key stop question is one `mypi_ask` with the literal output and the options
`Остановить (blocked)`, `Остановить`: the first sets `$BIN/mp-task status <KEY>
blocked "в потоке <name>: <one line>"`, both stop the run. A flow stop question has
the options `Остановить`, `Повторить`: the second runs the step again after the
engineer has fixed its cause.

- `{ answer, custom }` → append `- <YYYY-MM-DD HH:MM> <question in one line> →
  <answer>` (with ` (своё слово)` when `custom` is true) to `progress.md` in the
  key's task folder; an answer that belongs to no key goes to «Answers» of the score.
  It is committed with the next `mp-home-commit` of the run.
- `{ answer: null, cancelled: true }` → stop the run at once. The cancelled answer is
  not recorded; the only write after it is `$BIN/mp-home-commit <CODE> "flow <name>:
  stopped"`, which commits the answers already written. Report `остановлено
  инженером: <question>`; typing `/flow <name>` again resumes from the stage.
- An error result (no interactive UI) → stop and say that `/flow` needs an
  interactive Pi session.

`blocked` is set only when the engineer answers so; the run then stops, later keys
stay untouched.

## Never

- A GitHub Release or any other publication, a migration of the personal database,
  the engine update: only on the engineer's separate permission, never as a step of
  the run. The release by the project's `release` procedure after the answer
  «Одобрить» is that permission («Approval semantics» of `docs/PIPELINE.md`);
  nothing else is.
- Merging the PR other than in «Ship» after «Одобрить»; force-push; deleting a
  remote branch; `git worktree remove --force` or `git branch -D`; an edit of
  `plan.md` by the lead; a write in a key's worktree by the lead other than the
  merges, the install and the checks of this skill.
- Setting `done`: it stays the engineer's word.
