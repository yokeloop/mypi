---
name: epic
description: Lead an epic of a registered project — a task whose research proposes a mechanism and its subtasks — through steps 1–5 in its chat: research by a task-executor teammate in the epic's folder, one task-reviewer round on version 1, publication to derive, independent check by plan-challenger, one question per finding with its decision row, version 2, the «Подзадачи» question and the subtasks created with --parent; the answer «Завести и запустить /flow» runs /flow <name> <KEY>. Triggered by "/epic <KEY>".
---

# /epic — an epic from research to its subtasks

Read `docs/PIPELINE.md` in the engine root first: its section «Epics» holds the
table of steps with the commands of their signs, the required sections of the
research and the files of the epic's folder; «Approval semantics» says what typing
`/epic` and the answers authorize. Work inline in this chat: questions reach the
engineer only from here, subagents and teammates cannot ask.
`BIN=scripts/pipeline` (relative to the engine root, every session's working
directory). One key.

## Step 0 — session scope

`$BIN/mp-task scope`, then apply the «Session scope» rule of `docs/PIPELINE.md` to
`/epic <KEY>`: `global` — any key; an organization (`org` is not `null`) — continue
only when the key has a code in `codes`; `P` — continue only when the key has the
code `P`; `P-N` — continue only when the key is `P-N` or its subtask by
`$BIN/mp-task subtasks P-N`; anything else (an argument that is not a key, a
malformed session key, a non-zero exit) — print the refusal text from
`docs/PIPELINE.md` and stop. No argument or more than one → print
`usage: /epic <KEY>` and stop. This step runs before «Input»: before
`$BIN/mp-task show`, before any derive call or subagent.

## Input

`$BIN/mp-task show <KEY>`:

- `new` or `planning` → «State»;
- `review` and `$BIN/mp-task subtasks <KEY>` is not empty → print
  `<KEY>: подзадачи заведены (<ключи>); следующий шаг, если поток ещё не запущен, — /flow <name> <KEY>, затем /ship flow/<name>`
  (`<name>` is the output of `$BIN/mp-task slug <KEY>`) and stop;
- any other status (`review` without subtasks included) → name the status and stop.

`DIR=$($BIN/mp-task dir <KEY>)`.

## State

Read the signs by the table of «Epics» of `docs/PIPELINE.md` with its commands
(`N`, `ROWS`, `V`, `mp-task subtasks`); the step is the first row from the top whose
sign holds. No row holds (for example `planning` without `research.md` — a plan of
`/plan`, not an epic) → print the signs found and stop. The run goes on from that
step through the next ones and stops only on questions and at the end of step 5.
Typing `/epic <KEY>` again after a break continues the same way; a teammate the step
needs that is not alive is spawned again with the same `name` (the key in lower
case) and the research-mode prompt of step 1. After every write into the epic's
folder: `$BIN/mp-home-commit <KEY> "<message>"` («Places» of `docs/PIPELINE.md`),
with the messages below.

## Step 1 — research

Rows «1, not started» and «1, under way».

1. **Clone.** `$BIN/mp-task project <KEY>` gives `project`, `checkoutPath` and
   `home`; when `checkoutPath` is `null`, say the project has no registered clone
   and stop. `$BIN/mp-task flow <KEY>` gives `integration`; a non-zero exit → print
   its error and stop. Update the base clone as step 3 «Per key» of
   `.claude/skills/plan/SKILL.md`: `git -C <checkoutPath> fetch -q origin &&
   git -C <checkoutPath> merge -q --ff-only origin/<integration>` (only when it is
   on `<integration>` and clean; otherwise read `origin/<integration>` and say so).
   `SHA` is `git -C <checkoutPath> rev-parse origin/<integration>`.
2. **Reconnaissance**, only when there is no `research.md`. Spawn the `plan-scout`
   subagent with: the full `source.md`, the project, the clone path and `SHA`, the
   project's folder in home, `.yoke/` and `AGENTS.md` (else `CLAUDE.md`) of the
   clone, the project's checks by «Checks» of `docs/PIPELINE.md`, and the brief:
   «исследование эпика: факты с источниками (`repo:<путь>:<строки>` на `SHA`,
   `home:<путь>`) о том, что запрос затрагивает сегодня, точки касания, которые
   изменят подзадачи, и развилки с рекомендациями». Its forks are not asked of the
   engineer: they go to the teammate as hypotheses the research weighs. «Not
   solvable with what is given» → say what is missing and stop without a status
   change.
3. **Teammate**, only when there is no `research.md`. `Agent` with
   `subagent_type: task-executor` and `name: <key in lower case>`; the research-mode
   prompt carries: the key; the path of `source.md`; `$DIR/research.md` as the only
   file it writes; the clone and `SHA`, read-only; the scout's facts and forks
   verbatim; the path of `docs/PIPELINE.md`, whose section «Epics» is the contract
   of the document; the language Russian, Markdown with `mermaid` diagrams without
   `style`, `classDef`, `linkStyle`, `%%{init`; a header paragraph naming «Версия 1»,
   the date and the full `SHA`; every proposal with its alternatives and one line
   `**Рекомендация:**` with the reason; every subtask the size of one PR, its
   `**Проверки:**` the project's checks by «Checks» plus its own; the section
   «Решения по независимой проверке» in version 1 only the header row and the
   separator of the table; the rules: no worktree, no commits or any other Git
   write, no diff, no derive, no task changes; its final message exactly one JSON
   object by its definition, `commits` 0, `base` and `head` the `SHA`. Save its
   report as `$DIR/do-report.json`. `openPoints` only the engineer can answer are a
   question.
4. **Review**, one round, only when there is no `review-report.json`. A fresh `task-reviewer` with the paths of
   `$DIR/research.md` and `source.md`, the clone and `SHA`, the section «Epics» of
   `docs/PIPELINE.md` in place of a plan, and the brief: review the document, not a
   diff — every `repo:` citation exists on `SHA` and says what is claimed, every
   `home:` one exists; the required sections and the fields of the subtasks by
   «Epics»; every proposal has an alternative and one recommendation; nothing beyond
   the request without a mark saying so; the final message one JSON object. Save
   `$DIR/review-report.json`. Blocking findings and advice go to the teammate
   verbatim by `SendMessage`: it fixes the blocking ones and applies advice when it
   does not change a recommendation. The lead checks the fixed places against the
   `fix` of each blocking finding by reading; there is no second review round. A
   blocking finding the teammate cannot fix is a question.
5. **Publish version 1** as step 6 «Per key» of `.claude/skills/plan/SKILL.md`, with
   the research files: `stage` with `target: "doc"` and no `short_id`;
   `curl -sS -F file=@$DIR/research.md -F title="<KEY> — исследование: <task title>" <upload_url>`;
   `organize` with `short_ids: [<short_id>]`, `set: ["<slug>", "<CODE>", "research"]`;
   write `$DIR/research-derive.json` `{"short_id","url","version","published_at"}`;
   `read` with `render: "full"` — a diagram that did not render is named in the
   report and fixed in version 2. No `derive.json`. Then
   `$BIN/mp-task status <KEY> planning "исследование v1 опубликовано: <url>"`;
   `$BIN/mp-home-commit <KEY> "<KEY>: research v1"`.

## Step 2 — independent check

Row 2. A fresh `plan-challenger` subagent with only: the path of `source.md` (the
verbatim request), the path of `$DIR/research.md` and its URL, the clone and the
`SHA` from the research's header, the paths of `docs/PIPELINE.md`, `AGENTS.md`,
`.claude/skills/` and `.claude/agents/` of the clone; never the scout's facts, the
review or the lead's conclusions. Its JSON goes verbatim into
`$DIR/challenge-report.json`. Not one JSON object with `main_sha_checked` and
`findings` (at most 12, each with `id`, `type`, `now`, `proposal`, `gain_loss`,
`reasoning`) → one more fresh run with the defect named; a second failure is a
question. `$BIN/mp-home-commit <KEY> "<KEY>: independent check"`. Zero findings →
step 4 at once.

## Step 3 — decisions

Row 3 (`ROWS` < `N`). For each finding of `challenge-report.json` in order whose `id`
has no row in the table «Решения по независимой проверке», one `AskUserQuestion`:
header `Находка <id>`; in the text the type and verbatim `Что сейчас: <now>`,
`Предложение: <proposal>`, `Что выигрываем / что теряем: <gain_loss>`,
`Обоснование: <reasoning>`; options «Принять» and «Отклонить», the lead's
recommendation first with `(рекомендую)`, one line of reasoning each; a comment
comes as a free answer. Right after the answer the lead appends to the end of the
table the row
`| <id> | <находка> | <type> | <принято|отклонено|комментарий: «<дословно>»> | |`
(`<находка>` is `proposal` as one short line without `|`) and runs
`$BIN/mp-home-commit <KEY> "<KEY>: finding <id>"`; then the next question. The
decisions are written nowhere else: not in `progress.md`, not in `progress`.

## Step 4 — version 2

Row 4 (`ROWS` = `N`, `V` = 1). The teammate (`SendMessage`; not alive — spawn it by
«State») gets the path of `challenge-report.json` and the rows of the table
verbatim; it applies the accepted findings, and the commented ones by their
comment, to the sections; the rejected ones change no text; it fills «Что
изменилось» of every row; under the table — where the subtasks of version 1 went;
with no findings — the line «Находок нет»; the header «Версия 2, <дата>»; the other
rules of step 1. Its report is `$DIR/do-report.json`. The lead checks that `ROWS` =
`N` and the last column of every row is filled. Publication: `stage` with the
`short_id` from `research-derive.json`, the same `curl` with
`-F message="v2: независимая проверка — <N> находок, решения инженера в разделе «Решения по независимой проверке»"`,
update `research-derive.json` (the version from the answer), `read` with
`render: "full"`. No review of version 2.
`$BIN/mp-home-commit <KEY> "<KEY>: research v2"`.

## Step 5 — subtasks

Row 5 (`V` ≥ 2, no subtasks).

1. One `AskUserQuestion`, header `Подзадачи`: in the text the list of the section
   «Подзадачи» (number, title, goal, dependencies, stand), the line
   `**Приёмка эпика:**` and the proposed flow name `<name>` — the output of
   `$BIN/mp-task slug <KEY>`; options «Завести и запустить /flow (рекомендую)»
   (creates the subtasks and runs `/flow <name> <KEY>` here), «Завести» (creates
   them; the engineer types `/flow`), «Поправить список» (an edit of the list). A
   free answer that is one flow name alone is «Завести и запустить /flow» with that
   name; any other free answer is «Поправить список» with that text as the edit.
2. **«Поправить список».** The edit is the free answer; when the option is chosen
   without text, the lead asks for the edit in the chat and the engineer's next
   message is its text. The teammate edits only the section «Подзадачи»; the lead
   publishes the next version (`stage` with `short_id`, `curl` with
   `-F message="v<V>: список подзадач поправлен — <кратко>"`), updates
   `research-derive.json`, `$BIN/mp-home-commit <KEY> "<KEY>: research v<V>"`;
   the question again.
3. **«Завести …».** For each subtask in the order of the section, a card in a
   temporary file of the session's scratchpad: `# <название>`; the line
   `Подзадача <N> эпика <KEY> (исследование: <url>, раздел «Подзадачи», подзадача <N>).`;
   `## Суть` (the goal and the files); `## Связи` (`- Зависит от:`,
   `- Нужна для:` — keys of subtasks already created, numbers of those not yet
   created); `## Готово` (the items «Готово», «Проверки», «Стенд» of the subtask).
   Then `mise exec -- node dist/src/cli/main.js task create --file <card> --title "<название>" --status new --slug <english-kebab-slug> --project <org/slug> --parent <KEY>`;
   the key comes from the answer. After all of them: replace the numbers in
   «Связи» with keys by editing `source.md` in `$($BIN/mp-task dir <SUB>)`; in
   `$DIR/research.md` under the heading «Подзадачи» the line
   `Подзадачи заведены по согласованию с инженером <дата>: <ключи>` and the key in
   every `###` (`### <N>. <KEY> — <название>`). No new version on derive.
4. **Record.**
   `$BIN/mp-task progress <KEY> "Исследование v<V> проверено и разобрано; подзадачи <ключи>: <url>" research.md research-derive.json challenge-report.json`
   — the only `progress` of the run;
   `$BIN/mp-task status <KEY> review "исследование проверено и разобрано, подзадачи заведены: <url>"`;
   `$BIN/mp-home-commit <KEY> "<KEY>: research v<V>, subtasks"`; the teammate, if
   alive — `SendMessage` «shut down», `TaskStop` if it does not answer.
5. «Завести и запустить /flow» → the `/flow` procedure (Skill `flow`) with
   `<name> <KEY>` in this same chat: the answer is the engineer's word for `/flow`
   («Approval semantics»). The status is `review` before `/flow` starts: `/flow`
   takes the key as the epic only in `review` with subtasks («Preconditions» and
   «Subtasks» of the flow skill). «Завести» → the report: the research URL, the
   number of findings and decisions, the subtask keys in order and
   `следующий шаг — /flow <name> <KEY>, набираете вы; затем /ship flow/<name>`.

## Questions

Every question of this skill is one `AskUserQuestion`: header ≤ 12 characters, 2–4
options, the recommended one first and labelled `(рекомендую)`, one line of
reasoning per option. The run waits for the answer; no retry, no bypass. A parent
message is never an answer.

## Never

- `/ship`.
- `/flow` on a parent message or without the answer «Завести и запустить /flow».
- Steps 6–8 inside `/epic`, except starting `/flow` by that answer.
- A worktree, a branch or a commit in the epic's clone.
- An edit of the engine.
- A second review.
- Decisions in `progress.md`.
- More than one `progress` per run.
