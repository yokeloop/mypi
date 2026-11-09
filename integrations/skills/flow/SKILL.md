---
name: flow
description: Pi only. Run one or more tasks of one registered project to an agreed plan, one key at a time — session scope, subtasks, order, flow branch and score, reconnaissance by the scout role, every question to the engineer through mypi_ask, the plan by the planner role, published on derive, «Согласовать / Правки». Runs only when typed: "/flow <name> <KEY> [<KEY>…]", or "/flow <name>" in a project or task chat to resume.
---

# /flow in Pi — tasks of one project to an agreed plan

Read `docs/PIPELINE.md` in the engine root first: «Pi» binds the Claude pipeline to
Pi's tools, «Where /flow waits for the engineer» lists every stop of this skill. This
is the Pi counterpart of Claude's `.claude/skills/flow/SKILL.md` and keeps its rules
unless it says otherwise. Work inline in this chat: questions reach the engineer only
from here, through the `mypi_ask` tool; roles started with `subagent` cannot ask the
engineer. The typed command approves the run; the plan of each key is agreed by the
engineer's answer «Согласовать» («Approval semantics» of `docs/PIPELINE.md`).
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
  and the paths.
- Derive: the `derive` MCP server through codemode — `tools.mcp__derive__stage`,
  `tools.mcp__derive__organize`, `tools.mcp__derive__catch_up`,
  `tools.mcp__derive__comment`, each awaited. The upload goes through bash with
  `curl`. Roles have no MCP: every derive call and every mypi write is the lead's.
- Questions: `mypi_ask` («Questions»).

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
  `pr.md` naming this flow). Anything else → stop before starting.
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

1. Skip if already `review` with `pr.md` naming this flow, or if the key is the epic
   («Subtasks»).
2. **Stage.** Decide by the task folder and the score, without asking:
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
   the engineer's answer verbatim, the done criteria of `source.md` (they land in
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

## Execution of the key — part 2 (MP-118) continues here

Part 2 adds here: the base check before the key's execution, the execution by the
plan's «Execution», review, checks, the merge into the flow branch and the record;
the plan of the next key may be written while the current key executes. Until then:
report `план <KEY> согласован: <url> (v<version>); исполнение — часть 2, ещё не
реализовано` and stop the run. Later keys stay untouched.

## Questions

Every stop listed in «Where /flow waits for the engineer» of `docs/PIPELINE.md` and
every question of this skill is one `mypi_ask` call: `question` — the literal output
or finding and one line of reasoning per option; `options` — 2–4 short labels, the
recommended one first, without «(рекомендую)» and without «Своё слово» (the tool adds
both). Never ask in plain chat text and never two questions in one call. The run
waits for the answer; no retry, no bypass, no weakened check in its place.

- `{ answer, custom }` → append `- <YYYY-MM-DD HH:MM> <question in one line> →
  <answer>` (with ` (своё слово)` when `custom` is true) to `progress.md` in the
  key's task folder; an answer that belongs to no key goes to «Answers» of the score.
  It is committed with the next `mp-home-commit` of the run.
- `{ answer: null, cancelled: true }` → stop the run at once: no write after it, not
  even the answer. Report `остановлено инженером: <question>`; typing `/flow <name>`
  again resumes from the stage.
- An error result (no interactive UI) → stop and say that `/flow` needs an
  interactive Pi session.

`blocked` is set only when the engineer answers so; the run then stops, later keys
stay untouched.

## Never

- A GitHub Release or any other publication, a migration of the personal database,
  the engine update: only on the engineer's separate permission, never as a step of
  the run.
- Force-push, deleting a remote branch, merging a PR, an edit of `plan.md` by the
  lead.
