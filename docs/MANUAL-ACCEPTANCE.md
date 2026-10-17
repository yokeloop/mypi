# Agent-driven manual acceptance through Herdr

Use this guide when the operator requests end-to-end acceptance in a disposable
installation such as `mypi-test`, including driving the real Pi UI through Herdr.
It records the method used for MP-20 ([PR #29](https://github.com/yokeloop/mypi/pull/29)).
The [engine feature-development workflow](../AGENTS.md#engine-feature-development-workflow)
authorizes clean, recoverable acceptance for an approved feature in its designated
test installation. It does not authorize arbitrary resets, control of unrelated
sessions or merge.

The practical sequence is **clean stand → explicit checklist → real UI/MCP exercise
→ independent CLI/state checks → per-criterion evidence → operator acceptance**.
An agent can execute a manual checklist; that does not turn it into a deterministic
CI test or make the agent's narrative an independent oracle.

## 1. Scope and evidence before execution

Follow the [workspace workflow](../AGENTS.md#common-project-workflow) for source
changes and [testing policy](TESTING.md) for build/test execution. This guide adds
an operator-directed acceptance procedure, not another runner, test profile or
exception to mandatory checks. Do not add a framework or replay an entire workflow
when a small existing boundary test protects the contract.

Confirm the candidate SHA/PR, criteria, target installation, permitted reset paths,
Herdr workspace/tab, and whether the agent may drive it or only prepare it for the
operator. Explicitly distinguish test home/database from existing project checkouts,
archives and the primary installation. Obtain missing reset/control authorization outside the designated, approved
feature stand; previous acceptance is not permission for other destructive setup.

Interactive Pi/provider use is a separately authorized live exercise, outside the
network-free fast/boundary suites. State its allowed tools, provider access, bounded
waits and stopping conditions. It does not count as `verify` or prove OS isolation.
Do not change global settings, increase suite limits or use personal runtime data
as fixtures to make a scenario work. If required isolation is unavailable, stop the
suite rather than substituting an unbounded interactive run.

Record setup evidence outside managed task/journal data under test:

- Candidate SHA, installation path, branch/detached state, runtime versions.
- Actual home and DB paths, launcher/MCP routing, initial logical state.
- Build/verify commands and results; archive location and original revision.
- Checklist location, evidence directory, remaining untested criteria.

Never put secrets, real databases or unrelated session contents into Git reports.

## 2. Prepare a clean, recoverable stand

1. Inspect Git state, remotes, canonical paths, symlinks and current configuration.
   Preserve unrelated tracked, untracked and ignored files. A candidate may be
   installed in an explicitly authorized test checkout; develop fixes in a task
   worktree, not in that stand or the installed engine.
2. Stop the old Pi session normally and verify its MCP/storage writers have exited.
   If the operator owns an active session, ask them to close it unless control was
   explicitly authorized. An apparently idle screen or an empty `lsof` result alone
   does not establish that all writers are gone.
3. Preserve old test home, DB, local bindings/settings and their original paths in
   a private archive before replacing them. Capture SQLite consistently after
   writers stop, including any remaining associated WAL/SHM files; do not copy an
   active main DB alone or delete its sidecars. Do not reset `projects/`, global Pi
   settings, credentials or session history as collateral cleanup.
4. Install the exact reviewed candidate, provision its locked dependencies and
   build/verify under the prescribed limits. Do not patch the stand in place or
   call an older build evidence for a newer source revision.
5. Create explicitly isolated test home/state and the minimal local Pi configuration.
   Inspect the candidate's actual CLI/path contract: do not reuse an obsolete
   installation binding merely because an older experiment understood it. Pin the
   test state in both the launch environment and the project MCP configuration;
   keep the SQLite server behind the supported Node runtime, not Pi's host runtime.
6. Supply a small local Pi launcher and CLI wrapper that enter the test root and
   select the same test state. Explain which commands are safe to use. A raw CLI
   invocation without that environment can silently select the primary database.
   Do not add wrappers to product source merely to run acceptance.
7. Initialize only the authorized test DB and read back empty projects/tasks/history.
   For a no-Git save criterion, ensure test home has no `.git`: a setup wizard that
   initializes Git would invalidate that precondition. Do not alter the product
   bootstrap contract to accommodate the fixture.
8. Provide synthetic inputs with known expected bytes and deliberate edge cases.
   Keep old real data and existing project checkouts out of the fixtures.

Path/config separation is not a sandbox. Global tools and credentials may still be
available to a Pi session. Inspect the effective MCP connection and use only the
agreed services; do not claim that project configuration prevents all other access.
Retain archive and test results after acceptance. Restoring or cleaning up later
requires checking for new work and the applicable authorization, not blind rollback.

## 3. Write an executable checklist

Write a human-readable checklist in the operator's language, stored locally on the
stand or as an appropriate project artifact. Shared agent-facing guidance stays in
English. Each scenario needs:

| Field | Required content |
|---|---|
| Preconditions | Exact starting state, scope, fixture, prior steps and active writers |
| Action | Copyable CLI command or narrowly scoped Pi prompt/tool request |
| Expected result | Status/exit code, exact data and required files/events |
| Forbidden effects | What must remain absent or byte/logically unchanged |
| Independent check | CLI reread, byte comparison, hashes or observable UI/process state |
| Evidence/result | PASS, FAIL, BLOCKED or NOT RUN, with actual outputs and paths |

State ordering and whether each step is one-shot or replay-safe. Use returned IDs,
not guessed IDs, unless an empty stand is the explicit precondition. Capture exact
input bytes for source-fidelity checks; a model's paraphrase is not evidence.

Separate positive operations from deliberate errors. On `error`, `partial`, timeout
or lost connection, inspect actual state before retrying. Never create compensating
history or normalize an artifact merely to produce the expected result. Expected
failures pass only when both the refusal and unchanged-state criteria are met.

Cover the requested risks, not every conceivable feature. The MP-20 checklist used
no-Git saves, updates/artifacts, restart, refused overwrite, competing clients,
dirty Git/index lock, explicit legacy import/replay/refusal and existing backup.
Those are examples, not mandatory actions for every future change. In particular,
a backup file/hash check is not restore evidence; restore needs a different empty
target and its own authorization.

## 4. Drive the real Herdr/Pi surface

When control is authorized, consult the installed Herdr skill/help before commands.
The current skill requires `HERDR_ENV=1`; if it is absent, stop rather than attaching
to an unrelated focused session. Discover workspace/tab/pane IDs and process state.
Target the operator-selected pane explicitly, never the globally focused pane or
an ID guessed from sidebar order. Preserve focus/layout unless a change is requested.
No new tabs, agents or delegation are implied by this guide.

- Read the current screen and foreground process before sending input. If Pi already
  exited to a shell, report that; do not send shutdown keys to the shell or claim
  that you performed a shutdown you only observed.
- Launch the actual test entry point in that pane. A restart criterion requires a
  new process and, when specified, a fresh session rather than `--resume`/`--continue`.
  Record old/new session identities where available.
- Open the real `/mcp` UI. Verify connected state, project configuration provenance
  and server command path. Verify the test state environment independently through
  configuration and the actual server process if the UI does not display it. Read
  only the relevant environment variable; never dump credentials into evidence.
- Exit menus one level at a time and inspect the screen before prompting. Agent
  lifecycle `idle` alone does not prove that the text editor, rather than a menu,
  will receive the prompt. A stalled prompt is not success: inspect the screen and
  actual session state before resubmitting. Do not respond to approvals blindly.
- Give one bounded prompt per criterion or small coherent group. For MCP acceptance,
  explicitly require MCP calls, not a CLI substitute or direct DB reads. For a
  read-only scenario forbid task registration, progress/memory/journal writes,
  imports, initialization, commits and repairs.
- Use the installed `agent prompt`/`agent wait` controls with a finite timeout and
  inspect their result and the final screen. `unknown`, stale output or an absent
  lifecycle transition is not completion. Do not poll indefinitely or retry until
  green. Inspect tool results, not just the final assistant summary.
- Capture relevant terminal output/session/tool evidence, redacting secrets. If
  alternate-screen scrollback lost output, use a narrowly authorized evidence file
  or existing session trace; never silently convert a read-only data check into a
  managed journal write. Stop and report an infrastructure blocker if the intended
  UI/protocol cannot be exercised; do not substitute headless tests and call it the
  same manual scenario.

## 5. Independently verify persistence and absence of writes

Use separate CLI processes with the pinned test wrapper and compare against a
pre-action baseline. An MCP response proves that entry point; a CLI reread proves
another entry point; neither alone proves an unchanged file or absence of events.
Use byte comparisons for exact source/artifact contracts and logical snapshots for
cards/history. Hash the main DB only when its unchanged bytes are part of this
read-only scenario; do not generalize that to normal writes/checkpoints. SQLite
WAL/SHM behavior must follow the product's documented contract, not a blanket
"no filesystem changes" assertion.

### Example: MP-20 restart check, not a universal fixture

Precondition: REQ-1 and its artifacts already exist; the operator has completed the
write scenarios. Capture the card, full journal, source/artifact bytes and event
count **before** restarting. Do not replay creation or import to reconstruct them.

After observing the old Pi exit, start a new session with the test launcher, inspect
`/mcp`, then ask it to read only:

- `request_show` for REQ-1;
- `context_read` for `requests/REQ-1-manual/source.md` and `result.md`;
- `journal_read` scoped to `request:REQ-1`.

Independently, from the test root with its local wrapper:

```bash
./mp20-cli.sh request show REQ-1
./mp20-cli.sh journal read --all | jq length
cmp mp20-fixtures/source.txt home/requests/REQ-1-manual/source.md
```

These helper/fixture names belong to that prepared stand; create/check the appropriate
ones for a future scenario before using them. Expected in MP-20: title `MP20 renamed`,
status `in_progress`, artifact exactly `MP20 proof\nВторая строка.` with a real newline,
five existing request events, and full journal count **14 before and 14 after**.
`cmp` must produce no output and exit 0. The frozen count 14 is historical evidence,
not the expected count for future stands. Compare full history/card snapshots too:
unchanged count alone would miss replacement or modification of an event.

The completed MP-20 run checked all four MCP statuses, separate CLI outputs and
unchanged source/artifact/main-DB hashes. A second CLI invocation without a real
Pi restart would not have closed the originally missing restart criterion.

## 6. Close the evidence, not just the checklist

Report each criterion with expected/actual results and evidence, including partial
coverage, driver/tool-discovery errors and any limitations. Keep these separate:

1. Build and mandatory automated verification on the candidate.
2. Independent code/test review and CI.
3. Operator-directed live acceptance, including the real UI and restart boundaries.
4. Human acceptance and authorized merge.
5. Installation update, schema migration, restore or release (separate operations).

Do not mark unexecuted steps PASS, claim a reset guarantees routing, or infer rollout
permission from a green checklist. Stop at agreed criteria; do not launch later
roadmap stages. Publish only requested reports through the appropriate existing
workflow, outside the fixture history being checked. A read-only check must not
log its own success into that history and invalidate its no-write assertion.
