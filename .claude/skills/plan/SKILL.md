---
name: plan
description: Take one or more registered mypi tasks (MP-NN) to a plan ready for /do — reconnaissance in plan-scout, forks closed with the engineer (or by assumptions with --auto), plan written by plan-writer into the task folder, published to derive, task status set to planning. Also reworks a published plan from open derive comments. Triggered by "/plan <KEY> [<KEY>…] [--auto]".
---

# /plan — from a registered task to an approved-ready plan

Read ``docs/PIPELINE.md` in the engine root` first; it holds the places, statuses and
approval rules this skill relies on. Work inline in this chat: questions to the
engineer land here, reconnaissance and plan-writing run in subagents. A plan with
an open question in it is not done.

`BIN=scripts/pipeline` (relative to the engine root, the main chat's working directory). Keys are processed one after another, in the
order typed.

## Input

- `/plan <KEY>` — a task registered in mypi (`$BIN/mp-task show <KEY>` works).
  Status must be `new`, `planning` or `blocked`; anything else → say so and stop.
- `--auto` — no questions: every fork is closed by the scout's recommendation and
  recorded as an Assumption. `/batch` uses this.

## Per key

1. **Read the task.** `$BIN/mp-task show <KEY>`, `$BIN/mp-task source <KEY>`
   (the registration card: goal, scope, dependencies, done criteria, link to the
   general plan). Save the task folder path from `$BIN/mp-task dir <KEY>`.
   Read the matching card of the general plan on derive. The card number `T<N>`
   is in `source.md`. `read` of `b7wieok9` with `section: "t<N>"` (`t3` for T3):
   derive answers with an error that lists the valid section slugs; take the slug
   that starts with `t<N>-` (like `t1-снос-work-chats-mp-32-этап-1`) and repeat
   the `read` with `section` set to that slug. `section` accepts only a heading
   slug; the HTML id `t3` is not a heading slug. When the task depends on others (its «Связи» section), run
   `$BIN/mp-task v2` and note which dependencies are not yet `merged`/`review`:
   the plan must state what it waits for; it does not block planning.

2. **Rework or fresh?** If `derive.json` exists in the task folder, this is a
   rework: `catch_up` with that `short_id` and `comments: open`. Every open thread
   is a remark; quote it verbatim into the brief for the scout and the writer, and
   collect the thread ids to resolve them with `comment` in step 6. No open threads and a
   plan already published → say the plan stands and stop, unless the engineer
   typed a remark after the key — then that remark is the brief.

3. **Reconnaissance.** Update the base clone first:
   `git -C projects/yokeloop/mypi fetch -q origin &&
   git -C … merge -q --ff-only origin/main` (only when it is on `main` and clean;
   otherwise read `origin/main` and say so). Spawn the `plan-scout` subagent with:
   the full `source.md`, the general-plan card text, the remarks if any, the
   project `yokeloop/mypi`, the clone path, the glossary and ADRs at `.yoke/` in
   the clone, the engine rules at `AGENTS.md` of the clone, and the note that the
   engine's checks are `pnpm build` and `pnpm verify`. It returns facts with
   sources, assumptions and forks with recommendations. «Not solvable with what
   is given» → set status `blocked` with the reason, report what is missing, stop.

4. **Questions.** Without `--auto`: close the scout's forks with the engineer one
   at a time through `AskUserQuestion` — header ≤ 12 characters, 2–4 options,
   the recommended one first and labelled `(рекомендую)`, one line of reasoning
   per option. Only forks whose answer changes the implementation; everything
   else is looked up in the code or recorded as an assumption. The engineer's
   answer ends the question. Never a question: logs, extra checks, release,
   merging. With `--auto`: no questions; the recommendation of each fork becomes
   an Assumption.

5. **Plan.** Spawn the `plan-writer` subagent with: the key, the project, the
   task folder path, the scout's facts, every decision made above, the remarks
   addressed (rework), and the done criteria from `source.md` which must land in
   the plan's Acceptance section as executable checks. It writes
   `<task folder>/plan.md` by `docs/PLAN-FORMAT.md` and returns the path.
   Read the plan: an open question left in it is a defect — send it back once
   with the decisions it missed. The plan's first lines must name the key, the
   title and the general plan's URL.

6. **Publish.** One path for a fresh plan and a rework:
   1. Derive `stage` with `target: "doc"`; on rework pass `short_id` from
      `derive.json` (a new version of the same artifact), for a fresh plan pass
      no `short_id`.
   2. Upload to the `upload_url` from the `stage` answer:
      `curl -sS -F file=@<task folder>/plan.md -F title="<KEY> — план: <task title>" -F message="<what changed>" <upload_url>`.
      `message` only on rework; it names what changed for each remark. Take
      `short_id`, `url` and the version number from the upload answer.
   3. Fresh plan: `organize` with `short_ids: [<short_id>]`,
      `set: ["mypi", "v2", "plan"]`.
   4. Rework: resolve every open thread from step 2 with `comment`: `short_id`,
      `reply_to: <thread id>`, `set_state: "resolved"` and a one-line `body`
      saying what changed in the plan in answer to that remark.
   5. Write `derive.json` `{"short_id","url","version","published_at"}` in the
      task folder; `version` is the version number from the upload answer.
   6. `derived_from` is not used: the link to the general plan is the URL in the
      plan's first lines (step 5). An inline `publish` with `content` is not used
      for the plan.

7. **Record.**
   1. `cp <task folder>/plan.md <task folder>/plan-v<version>.md`, `<version>`
      from `derive.json`. Nobody edits the snapshot afterwards; `plan.md` stays
      the live working copy that `/do`, the executor and the reviewer read, and
      it is never registered.
   2. Fresh plan:
      `$BIN/mp-task progress <KEY> "План v<version> опубликован: <url>" plan-v<version>.md`.
      Rework:
      `$BIN/mp-task progress <KEY> "План v<version> опубликован: <url>; переработка: <что изменилось>" plan-v<version>.md`.
   3. `$BIN/mp-task status <KEY> planning "план опубликован, ждёт согласования: <url>"`.
      On rework the status is already `planning`: this call writes nothing to the
      journal (`changed: false`) and its reason is lost, so the rework reason
      lives in the `progress` entry of item 2.
   4. `$BIN/mp-home-commit "<KEY>: plan v<version>"`.

8. **Report** one line per key: the key, the derive URL, «ждёт согласования —
   /do <KEY> запускает». A published plan starts nothing.
