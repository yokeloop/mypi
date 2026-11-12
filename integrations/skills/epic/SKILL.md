---
name: epic
description: 'Pi only. Lead an epic of a registered project — a task whose research proposes a mechanism and its subtasks — through steps 1–5 in its chat: research by the executor role in research mode in the folder of the epic, one reviewer round on version 1, publication on derive, the independent check by the challenger role, one mypi_ask per finding with its decision row, version 2, the «Подзадачи» question and the subtasks created with --parent; the answer «Завести и запустить /flow» hands the run to the Pi /flow skill in this chat. Runs only when typed: "/epic <KEY>".'
---

# /epic in Pi — an epic from research to its subtasks

Read `docs/PIPELINE.md` in the engine root first: «Epics» holds the table of steps
with the commands of their signs, the required sections of the research and the files
of the epic's folder; «Approval semantics» says what typing `/epic` and the answers
authorize; «Pi» binds the Claude pipeline to Pi's tools. This is the Pi counterpart of
Claude's `.claude/skills/epic/SKILL.md` and keeps its rules unless it says otherwise.
Work inline in this chat: questions reach the engineer only from here, through the
`mypi_ask` tool; roles started with `subagent` cannot ask the engineer.
`BIN=scripts/pipeline`; run every script with bash from the engine root (this
session's working directory). One key.

## Tools

- Scripts: `$BIN/mp-task …` and `$BIN/mp-home-commit …` through bash. Bash exports
  this session's `PI_SESSION_ID`, so `$BIN/mp-task scope` reads this chat's scope.
- Roles: the `subagent` tool. It is enabled lazily: when `subagent` is not
  available, call `subagents_enable` first. Call `subagent` with its default options
  and without `async: true`; in an interactive session the run goes to the background
  and wakes this chat when it ends — wait for it, never rely on `bg_wait`, it may
  return at once with «No active async runs». A role that asks the lead with
  `contact_supervisor` stays `running` and wakes this chat with
  `subagent_supervisor_request`: answer it with `subagent_supervisor` from
  `source.md`, the research and the engineer's answers, or ask the engineer through
  `mypi_ask` first. A role's own `PI_SESSION_ID` has no scope: every role's task names
  the key and the paths. A role's answer is its structured output by its
  `outputSchema`.
- The executor of step 1 is continued with `subagent({ action: "resume", id: "<run
  id>", message })`: it returns a new run id, and the next resume uses the newest.
  The run ids live in this chat and in the last `executor run id:` line of
  `$DIR/knowledge.md`. No run id in either (Pi was restarted) or a refused resume → a fresh `subagent({ agent: "executor", task })` with the
  research-mode task of step 1 followed by the message; the report of step 5 names
  the fallback.
- Derive: the `derive` MCP server through codemode — `tools.mcp__derive__stage`,
  `tools.mcp__derive__organize`, `tools.mcp__derive__read`, each awaited. The upload
  goes through bash with `curl`. Roles have no MCP: every derive call and every mypi
  write is the lead's.
- Subtasks: `mise exec -- node dist/src/cli/main.js task create …` through bash.
- Questions: `mypi_ask` («Questions»).
- Compaction: the extension tool `mypi_compact` («Boundary» of step 1 and of
  step 4). Call it directly, never from a codemode script, and alone as the last
  call of the turn; the turn ends there. It refuses while the project's home has uncommitted changes:
  commit what it lists and call again. The extension compacts the context after the
  turn, saves the summary to the epic's `compactions.md` and sends
  `/skill:epic <KEY>`; this skill then starts over from Step 0 and continues by
  «State».
- Time: every `<YYYY-MM-DD HH:MM>` of this skill is the output of
  `date '+%Y-%m-%d %H:%M'`, every `<YYYY-MM-DD>` the output of `date +%F`, and
  `published_at` the output of `date -Iseconds`, run through bash right before the
  write that carries it; never a time typed by hand or guessed.

## Step 0 — session scope

`$BIN/mp-task scope`, then apply the «Session scope» rule of `docs/PIPELINE.md` to
`/epic <KEY>`: `global` — any key; an organization (`org` is not `null`) — continue
only when the key has a code in `codes`; `P` — continue only when the key has the
code `P`; `P-N` — continue only when the key is `P-N` or its subtask by
`$BIN/mp-task subtasks P-N`; anything else (an argument that is not a key, a
malformed session key, a non-zero exit) — print the refusal text from
`docs/PIPELINE.md` and stop. No argument or more than one → print
`usage: /epic <KEY>` and stop. This step runs before «Input»: before
`$BIN/mp-task show`, before any derive call or `subagent`.

## Input

`$BIN/mp-task show <KEY>`:

- `new` or `planning` → «State»;
- `review` and `$BIN/mp-task subtasks <KEY>` is not empty → print
  `<KEY>: подзадачи заведены (<ключи>); следующий шаг, если поток ещё не запущен, — /flow <name> <KEY>; в Pi /ship — ответ «Одобрить» потока`
  (`<name>` is the output of `$BIN/mp-task slug <KEY>`) and stop;
- any other status (`review` without subtasks included) → name the status and stop.

`DIR=$($BIN/mp-task dir <KEY>)`.

## State

Read the signs by the table of «Epics» of `docs/PIPELINE.md` with its commands
(`N`, `ROWS`, `V`, `mp-task subtasks`); the step is the first row from the top whose
sign holds. Before going on, read `$DIR/knowledge.md` when it exists and the
project's entry `<project home>/INDEX.md` with the branches it links that concern
the epic. No row holds (for example `planning` without `research.md` — a plan of
`/plan`, not an epic) → print the signs found and stop. The run goes on from that
step through the next ones and stops only on questions and at the end of step 5.
Typing `/epic <KEY>` again after a break continues the same way; the executor a step
needs is resumed, or started fresh, by «Tools». After every write into the epic's
folder: `$BIN/mp-home-commit <KEY> "<message>"` («Places» of `docs/PIPELINE.md`),
with the messages below.

## Step 1 — research

Rows «1, not started» and «1, under way».

1. **Clone.** `$BIN/mp-task project <KEY>` gives `project`, `checkoutPath` and
   `home`; when `checkoutPath` is `null`, say the project has no registered clone
   and stop. `$BIN/mp-task flow <KEY>` gives `integration`; a non-zero exit → print
   its error and stop. `git -C <checkoutPath> fetch -q origin`; then, only when
   `git -C <checkoutPath> branch --show-current` prints `<integration>` and
   `git -C <checkoutPath> status --porcelain` prints nothing,
   `git -C <checkoutPath> merge -q --ff-only origin/<integration>`; otherwise read
   `origin/<integration>` and say so. `SHA` is
   `git -C <checkoutPath> rev-parse origin/<integration>`.
2. **Reconnaissance**, only when there is no `research.md`.
   `subagent({ agent: "scout", task })`; the task carries, as text: the key, the full
   `source.md` (`$BIN/mp-task source <KEY>`), the project, the clone path and `SHA`
   (read-only; `git -C <clone> show <SHA>:<path>` reads that commit), the project's
   folder in home, `.yoke/` and `AGENTS.md` (else `CLAUDE.md`) of the clone when they
   exist, the project's checks by «Checks» of `docs/PIPELINE.md`, and the brief:
   «исследование эпика: факты с источниками (`repo:<путь>:<строки>` на `SHA`,
   `home:<путь>`) о том, что запрос затрагивает сегодня, точки касания, которые
   изменят подзадачи, и развилки с рекомендациями». Its forks are not asked of the
   engineer: they go to the executor as hypotheses the research weighs.
   `solvable: false` → say what `missing` lists and stop without a status change. No
   structured output or a failed run → one `mypi_ask` with the error, options
   `Повторить разведку`, `Остановить`.
3. **Executor**, only when there is no `research.md`.
   `subagent({ agent: "executor", task })`; the research-mode task carries, as text:
   «Research mode: the research of an epic, no worktree.»; the key; the path of
   `source.md`; `$DIR` as the folder and `$DIR/research.md` as the only file it
   writes; the clone and `SHA`, read-only; the scout's `facts` and `forks` verbatim;
   the path of `docs/PIPELINE.md`, whose section «Epics» is the contract of the
   document; the language Russian, Markdown with `mermaid` diagrams without `style`,
   `classDef`, `linkStyle`, `%%{init`; a header paragraph naming «Версия 1», the date
   and the full `SHA`; every proposal with its alternatives and one line
   `**Рекомендация:**` with the reason; every subtask the size of one PR, its
   `**Проверки:**` the project's checks by «Checks» plus its own; the section
   «Решения по независимой проверке» in version 1 only the header row and the
   separator of the table; the rules: no worktree, no commits or any other Git
   write, no diff, no derive, no task changes; its answer by its schema with
   `branch` and `head` null, `base` the `SHA`, `commits` 0. Keep its run id. Write
   its structured output as `$DIR/do-report.json`. Each of its `openQuestions` only
   the engineer can answer is one `mypi_ask`; the answers go to it by resume.
4. **Review**, one round, only when there is no `review-report.json`.
   `subagent({ agent: "reviewer", task })`, a fresh run; the task carries, as text:
   «Review a document, not a diff: there is no worktree and no diff range; answer by
   your schema.»; the key; the paths of `$DIR/research.md` and `source.md`; the clone
   and `SHA`, read-only; the section «Epics» of `docs/PIPELINE.md` in place of a
   plan; the brief: every `repo:` citation exists on `SHA` and says what is claimed,
   every `home:` one exists; the required sections and the fields of the subtasks by
   «Epics»; every proposal has an alternative and one recommendation; nothing beyond
   the request without a mark saying so; each finding's `file` is the path of
   `research.md` and `line` its line there; `outsidePlan` is an empty list. Write its
   structured output verbatim as `$DIR/review-report.json` — one object, not the
   rounds of the Pi `/flow`. Blocking findings and advice go to the executor by
   resume, verbatim, with «fix the blocking findings in research.md, apply advice
   when it does not change a recommendation, and answer again with your whole
   report»; its report becomes `do-report.json`. Check the fixed places against the
   `fix` of each blocking finding by reading; there is no second review round. A
   blocking finding that is still not fixed → one `mypi_ask` with the finding and
   the place, options `Остановить`, `Опубликовать как есть`.
5. **Publish version 1:**
   1. `await tools.mcp__derive__stage({ target: "doc" })`, no `short_id`.
   2. Upload through bash: `curl -sS -F file=@$DIR/research.md -F title="<KEY> —
      исследование: <task title>" <upload_url>`; take `short_id`, `url` and the
      version number from the answer.
   3. `tools.mcp__derive__organize({ short_ids: [<short_id>], set: ["<slug>",
      "<CODE>", "research"] })` (`<slug>` is the project slug).
   4. Write `$DIR/research-derive.json` `{"short_id","url","version","published_at"}`.
      No `derive.json`.
   5. `tools.mcp__derive__read({ short_id, render: "full" })`: a diagram that did not
      render is named in the report and fixed in version 2.
   6. `$BIN/mp-task status <KEY> planning "исследование v1 опубликовано: <url>"`;
      `$BIN/mp-home-commit <KEY> "<KEY>: research v1"`, in a bash call of its own:
      never chain it with a command of step 2.
6. **Boundary.** Before any command of step 2: do the knowledge checkpoint, commit
   home, call `mypi_compact` and end the turn:
   1. The knowledge checkpoint: append to `$DIR/knowledge.md` a section
      `## <YYYY-MM-DD HH:MM> — перед сжатием (исследование v1)` with the line
      `executor run id: <the newest executor run id>`, the scout's facts and forks and
      the reviewer's findings not carried into `research.md` (link the reports, never
      copy them), pitfalls and open points; facts true beyond the epic → the project's
      entry or its branch with `context commit` (as «Knowledge» of the Pi `/flow` skill
      says); the decisions on findings stay only in their table.
   2. `$BIN/mp-home-commit <KEY> "<KEY>: knowledge v1"`.
   3. `mypi_compact({ key: "<KEY>", resume: "/epic <KEY>", focus: "<KEY>: research v1 published <url>; next step 2" })`
      — the last call of the turn; end the turn.

   A refusal: commit what it lists and call again; a second refusal → one `mypi_ask`
   with the literal error, options `Остановить`, `Продолжить без сжатия`. Skip this
   only when `subagent({ action: "status" })` lists a running run of this chat — then
   go on with step 2.

## Step 2 — independent check

Row 2. `subagent({ agent: "challenger", task })`, a fresh run; the task carries only:
the path of `source.md` (the verbatim request), the path of `$DIR/research.md` and
its URL, the clone and the `SHA` from the research's header, the paths of
`docs/PIPELINE.md`, `AGENTS.md`, `.claude/skills/`, `.claude/agents/`,
`integrations/skills/` and `integrations/pi-flow/` in the engine root, and
`AGENTS.md` (else `CLAUDE.md`) of the clone when it exists; never the scout's facts,
the review or the lead's conclusions. Write its structured output verbatim as
`$DIR/challenge-report.json`. No structured output or a failed run → one more fresh
run with the defect named in its task; a second failure → one `mypi_ask` with the
error, options `Остановить`, `Повторить проверку`.
`$BIN/mp-home-commit <KEY> "<KEY>: independent check"`. Zero findings → step 4 at
once.

## Step 3 — decisions

Row 3 (`ROWS` < `N`). For each finding of `challenge-report.json` in order whose `id`
has no row in the table «Решения по независимой проверке», one `mypi_ask`:
`question` —

```
Находка <id> (<type>).
Что сейчас: <now>
Предложение: <proposal>
Что выигрываем / что теряем: <gain_loss>
Обоснование: <reasoning>
Принять — <one line of reasoning>; Отклонить — <one line of reasoning>.
```

with the fields verbatim; `options` — `Принять` and `Отклонить`, the lead's
recommendation first. Right after the answer append to the end of the table the row
`| <id> | <находка> | <type> | <принято|отклонено|комментарий: «<дословно>»> | |`
(`<находка>` is `proposal` as one short line without `|`; `Принять` → `принято`,
`Отклонить` → `отклонено`, an own word → `комментарий: «<the answer verbatim>»`) and
run `$BIN/mp-home-commit <KEY> "<KEY>: finding <id>"`; then the next question. The
decisions are written nowhere else: not in `progress.md`, not in `progress`.

## Step 4 — version 2

Row 4 (`ROWS` = `N`, `V` = 1). The executor by resume («Tools») gets the path of
`challenge-report.json`, the rows of the table verbatim and the diagrams that did not
render, with: apply the accepted findings, and the commented ones by their comment,
to the sections; the rejected ones change no text; fill «Что изменилось» of every
row; under the table — where the subtasks of version 1 went; with no findings — the
line «Находок нет»; the header «Версия 2, <YYYY-MM-DD>»; the other rules of the
research-mode task; «answer again with your whole report». Its report becomes
`$DIR/do-report.json`. Check that `ROWS` = `N` and that the last column of every row
is filled (`awk '/^## .*Решения по независимой проверке/,/^## Источники/'
$DIR/research.md | grep '^| [0-9]' | grep -c '| *|$'` prints `0`); not so → the
defect to the executor by resume once; still not so → one `mypi_ask` with the
defect, options `Остановить`, `Опубликовать как есть`. Publication:
`tools.mcp__derive__stage({ target: "doc", short_id })` with the `short_id` of
`research-derive.json`; the same `curl` with
`-F message="v2: независимая проверка — <N> находок, решения инженера в разделе «Решения по независимой проверке»"`;
update `research-derive.json` (the version from the answer, `published_at`);
`tools.mcp__derive__read({ short_id, render: "full" })`. No review of version 2.
`$BIN/mp-home-commit <KEY> "<KEY>: research v2"`, in a bash call of its own: never
chain it with a command of step 5.

**Boundary.** Before any command of step 5: do the knowledge checkpoint, commit
home, call `mypi_compact` and end the turn:
1. The knowledge checkpoint: append to `$DIR/knowledge.md` a section
   `## <YYYY-MM-DD HH:MM> — перед сжатием (исследование v2)` with the line
   `executor run id: <the newest executor run id>`, the scout's facts and forks and
   the reviewer's findings not carried into `research.md` (link the reports, never
   copy them), pitfalls and open points; facts true beyond the epic → the project's
   entry or its branch with `context commit` (as «Knowledge» of the Pi `/flow` skill
   says); the decisions on findings stay only in their table.
2. `$BIN/mp-home-commit <KEY> "<KEY>: knowledge v2"`.
3. `mypi_compact({ key: "<KEY>", resume: "/epic <KEY>", focus: "<KEY>: research v2 published <url>; next step 5" })`
   — the last call of the turn; end the turn.

A refusal: commit what it lists and call again; a second refusal → one `mypi_ask`
with the literal error, options `Остановить`, `Продолжить без сжатия`. Skip this
only when `subagent({ action: "status" })` lists a running run of this chat — then
go on with step 5.

## Step 5 — subtasks

Row 5 (`V` ≥ 2, no subtasks). `<name>` is the output of `$BIN/mp-task slug <KEY>`.

1. One `mypi_ask`: `question` —

   ```
   Подзадачи <KEY>:
   <N>. <title> — <goal>; зависимости: <dependencies>; стенд: <stand>
   …
   **Приёмка эпика:** <the line of the research>
   Поток: <name>.
   Завести и запустить /flow — подзадачи заводятся, затем в этом чате идёт /flow <name> <KEY>; Завести — подзадачи заводятся, /flow набираете вы. Своё слово — правка списка; ответ из одного имени потока — завести и запустить /flow с этим именем.
   ```

   `options` — `Завести и запустить /flow`, `Завести`. An own word that matches
   `^[a-z0-9][a-z0-9-]*$` is «Завести и запустить /flow» with that word as `<name>`;
   any other own word is an edit of the list.
2. **An edit of the list.** The executor by resume gets the edit verbatim and edits
   only the section «Подзадачи»; then publish the next version
   (`tools.mcp__derive__stage({ target: "doc", short_id })`, `curl` with
   `-F message="v<V>: список подзадач поправлен — <кратко>"`), update
   `research-derive.json`, `tools.mcp__derive__read({ short_id, render: "full" })`,
   `$BIN/mp-home-commit <KEY> "<KEY>: research v<V>"`; the question again.
3. **«Завести …».** For each subtask in the order of the section, a card in a
   temporary file `card=$(mktemp)`: `# <название>`; the line
   `Подзадача <N> эпика <KEY> (исследование: <url>, раздел «Подзадачи», подзадача <N>).`;
   `## Суть` (the goal and the files); `## Связи` (`- Зависит от:`,
   `- Нужна для:` — keys of subtasks already created, numbers of those not yet
   created); `## Готово` (the items «Готово», «Проверки», «Стенд» of the subtask).
   Then `mise exec -- node dist/src/cli/main.js task create --file "$card" --title "<название>" --status new --slug <english-kebab-slug> --project <org/slug> --parent <KEY>`;
   the key comes from its output; `rm -f "$card"`. After all of them: replace the
   numbers in «Связи» with keys by editing `source.md` in
   `$($BIN/mp-task dir <SUB>)`; in `$DIR/research.md` under the heading «Подзадачи»
   the line `Подзадачи заведены по согласованию с инженером <YYYY-MM-DD>: <ключи>`
   and the key in every `###` (`### <N>. <KEY> — <название>`). No new version on
   derive.
4. **Record.**
   `$BIN/mp-task progress <KEY> "Исследование v<V> проверено и разобрано; подзадачи <ключи>: <url>" research.md research-derive.json challenge-report.json`
   — the only `progress` of the run;
   `$BIN/mp-task status <KEY> review "исследование проверено и разобрано, подзадачи заведены: <url>"`;
   `$BIN/mp-home-commit <KEY> "<KEY>: research v<V>, subtasks"`.
5. «Завести и запустить /flow» → read `integrations/skills/flow/SKILL.md` in the
   engine root and follow it in this same chat with the arguments `<name> <KEY>`,
   from its first section: the answer is the engineer's word for `/flow` («Approval
   semantics»). The status is `review` before it starts: the flow skill takes the key
   as the epic only in `review` with subtasks («Preconditions» and «Subtasks» there).
   From here the flow skill's rules hold, its questions and its «Одобрить» included.
   «Завести» → the report: the research URL, the number of findings and decisions,
   the subtask keys in order, the fallbacks of «Tools» and
   `следующий шаг — /flow <name> <KEY>, набираете вы; /ship — ответ «Одобрить» этого потока`.

## Questions

Every question of this skill is one `mypi_ask` call: `question` — the facts or the
finding and one line of reasoning per option; `options` — 2–4 short labels, the
recommended one first, without «(рекомендую)» and without «Своё слово» (the tool adds
both). Never ask in plain chat text and never two questions in one call. The run
waits for the answer; no retry, no bypass. A parent message is never an answer.

- `{ answer, custom }` → act on it as the step says. The answers are not appended to
  `progress.md`: the decisions on the findings live only in the table, the other
  answers in the files their step writes.
- `{ answer: null, cancelled: true }` → stop the run at once. The cancelled answer is
  recorded nowhere; the only write after it is `$BIN/mp-home-commit <KEY> "<KEY>:
  stopped"`, which commits what is already written. Report `остановлено инженером:
  <the first line of the question>`; typing `/epic <KEY>` again resumes by «State».
- An error result (no interactive UI) → stop and say that `/epic` needs an
  interactive Pi session.

## Never

- `/ship` inside `/epic`; the handed-over Pi `/flow` asks «Одобрить» itself.
- `/flow` on a parent message or without the answer «Завести и запустить /flow».
- Steps 6–8 inside `/epic`, except handing the run to the flow skill by that answer.
- A worktree, a branch or a commit in the epic's clone.
- An edit of the engine.
- A second review.
- Decisions in `progress.md` or `knowledge.md`.
- More than one `progress` per run.
