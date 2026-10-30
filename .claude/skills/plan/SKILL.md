---
name: plan
description: Take one or more registered tasks of any registered project (CODE-N) to a plan ready for /do — reconnaissance in plan-scout, forks closed with the engineer (or by assumptions with --auto), plan written by plan-writer into the task folder, published to derive, task status set to planning. Also reworks a published plan from open derive comments. Triggered by "/plan <KEY> [<KEY>…] [--auto]".
---

# /plan — from a registered task to an approved-ready plan

Read `docs/PIPELINE.md` in the engine root first; it holds the places, statuses and
approval rules this skill relies on. Work inline in this chat: questions to the
engineer land here, reconnaissance and plan-writing run in subagents. A plan with
an open question in it is not done.

`BIN=scripts/pipeline` (relative to the engine root, every session's working directory). Keys are processed one after another, in the
order typed.

## Step 0 — session scope

`$BIN/mp-task scope`, then apply the «Session scope» rule of `docs/PIPELINE.md` to
`/plan` and every typed key: `global` — any key; `P` — continue only when every
typed key has the code `P`; `P-N` — continue only when every typed key equals
`P-N`; anything else (an argument that is not a key, a malformed session key, a
non-zero exit) — print the refusal text from `docs/PIPELINE.md` and stop. This step
runs before the status check in «Input», before `$BIN/mp-task show` and before any
derive call or subagent, so `/plan MP-41` in a TBA chat stops on the scope, not on
the status.

## Input

- `/plan <KEY>` — a task registered in mypi (`$BIN/mp-task show <KEY>` works).
  Status must be `new`, `planning` or `blocked`; anything else → say so and stop.
- `--auto` — no questions: every fork is closed by the scout's recommendation and
  recorded as an Assumption. `/batch` uses this.

## Per key

1. **Read the task.** `$BIN/mp-task show <KEY>`, `$BIN/mp-task source <KEY>`
   (the registration card: goal, scope, dependencies, done criteria, link to the
   general plan, if any). Save the task folder path from `$BIN/mp-task dir <KEY>`.
   Read the general plan only when `source.md` links a derive artifact as the
   general plan and names the card `T<N>`; without such a link there is no general
   plan and this part is skipped. Then `read` of that artifact's `short_id` (for the
   v2 cards of MP `b7wieok9`) with `section: "t<N>"` (`t3` for T3):
   derive answers with an error that lists the valid section slugs; take the slug
   that starts with `t<N>-` (like `t1-снос-work-chats-mp-32-этап-1`) and repeat
   the `read` with `section` set to that slug. `section` accepts only a heading
   slug; the HTML id `t3` is not a heading slug. When the task depends on others (its «Связи» section), run
   `$BIN/mp-task board <CODE> all` and note which dependencies are not yet `merged`/`review`:
   the plan must state what it waits for; it does not block planning.

2. **Rework or fresh?** If `derive.json` exists in the task folder, this is a
   rework: `catch_up` with that `short_id` and `comments: open`. Every open thread
   is a remark; quote it verbatim into the brief for the scout and the writer, and
   collect the thread ids to resolve them with `comment` in step 6. No open threads and a
   plan already published → say the plan stands and stop, unless the engineer
   typed a remark after the key — then that remark is the brief.

3. **Reconnaissance.** `$BIN/mp-task project <KEY>` gives `project`, `checkoutPath`
   and `home`; when `checkoutPath` is `null`, say the project has no registered
   clone and stop. Update the base clone first:
   `git -C <checkoutPath> fetch -q origin &&
   git -C <checkoutPath> merge -q --ff-only origin/main` (only when it is on `main` and clean;
   otherwise read `origin/main` and say so). Spawn the `plan-scout` subagent with:
   the full `source.md`, the general-plan card text if there is one, the remarks if
   any, the project `<org>/<slug>`, the clone path `<checkoutPath>`, the project's
   folder in home, `.yoke/` and `AGENTS.md` (else `CLAUDE.md`) of the clone when they
   exist, and the project's checks by «Checks» of `docs/PIPELINE.md` (MP: `pnpm build`
   and `pnpm verify`); when the project's instructions name no checks, the scout
   reports that as a fact. It returns facts with
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
   the plan's Acceptance section as executable checks; when the project's
   instructions name no checks, the Acceptance section names concrete check commands
   that run in the worktree. It writes
   `<task folder>/plan.md` by `docs/PLAN-FORMAT.md` and returns the path.
   Read the plan: an open question left in it is a defect — send it back once
   with the decisions it missed. The plan's first lines must name the key, the
   title and the general plan's URL when the card links one; otherwise a line saying
   there is no general plan.

6. **Publish.** One path for a fresh plan and a rework:
   1. Derive `stage` with `target: "doc"`; on rework pass `short_id` from
      `derive.json` (a new version of the same artifact), for a fresh plan pass
      no `short_id`.
   2. Upload to the `upload_url` from the `stage` answer:
      `curl -sS -F file=@<task folder>/plan.md -F title="<KEY> — план: <task title>" -F message="<what changed>" <upload_url>`.
      `message` only on rework; it names what changed for each remark. Take
      `short_id`, `url` and the version number from the upload answer.
   3. Fresh plan: `organize` with `short_ids: [<short_id>]`,
      `set: ["<slug>", "<CODE>", "plan"]` (`<slug>` is the project slug from
      `project`, `mypi` for MP), plus `"v2"` only when the card links `b7wieok9`.
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
   4. `$BIN/mp-home-commit <KEY> "<KEY>: plan v<version>"`.

8. **Report** one line per key: the key, the derive URL, «ждёт согласования —
   /do <KEY> запускает». A published plan starts nothing.
