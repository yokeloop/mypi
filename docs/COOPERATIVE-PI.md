# Cooperative Pi: operator handoff

Ordinary Pi owns the terminal, tools, session IDs and history. mypi adds working
context and checks for common mistakes, **not a sandbox or permission system**.
This is the short operating route; linked documents own the detailed contracts.
Preparation, delivery for review, and activation are separate gates (see below).

## Start and resume

Use an already built engine, installed Pi and registered project with an independent
clone. These commands do not initialize storage, create requests or prepare worktrees:

```sh
mypi pi --project org/project --base /clones/project --cwd /clones/project--task
mypi pi --project org/project --base /clones/project --cwd /clones/project--task -- --continue
```

`--cwd` is an existing associated worktree **root**; without it the chosen base is
available for study. Native options follow `--`: use `--resume` for Pi's picker or
`--session /path/to/session.jsonl` for a known saved conversation. `/session` shows
the native ID/file. `--org org` needs a concrete project/worktree before changes;
`--unrestricted` removes project filtering. No selection means unselected, not
unrestricted. The engine's `mise exec -- pnpm pi` alias uses the same launcher.

Selection lives in the current native branch, not a mypi session database. Resume,
reload, tree and fork follow that branch; missing/invalid/foreign-cwd entries clear
selection rather than revive another project. `/new` is unselected. To change cwd
or choose a different project, start a new process/session. A conflicting launcher
selection never overwrites resumed context. Pi 1.0.4 does not persist an otherwise
empty conversation just for custom entries. See [native context and launch](PI-WORK-CONTEXT.md).

## Understand the visible guardrails

The status shows the selection and MCP **requested/unconfirmed**. Use native `/mcp`
for actual connection diagnostics: a same-name user MCP entry overrides extension
registration, including `enabled:false`. A registration request is not proof of
routing; old in-flight operations are not reassigned or guaranteed to drain.

With a valid scoped task selection, supported native `write`/`edit` calls permit
own-worktree targets and block base/foreign paths by default, including ordinary
symlink mistakes. Read/search remain available. Configure only an explicitly chosen
absolute `MYPI_GUARD_POLICY` file; [YAML v2](SCOPED-POLICY-CORE.md) is:

```yaml
version: 2
guards:
  outsideWorktreeWrite: block
  baseCheckoutWrite: block
  foreignMypiTarget: block
```

`warn` visibly warns but permits. Invalid explicit configuration is not a fallback
to defaults: native write/edit are blocked until fixed and reloaded. `/reload`
rereads native policy; MCP setup reads independently on restart/reconnect. Contextual
mypi commands use [documented membership/default checks](MCP.md#cooperative-application-membership-and-defaults),
not blanket restrictions. Unselected/unrestricted Pi has no project path guard.
Shell, direct Git/CLI, foreign MCP/custom-tool IO and disabled extensions can bypass
these checks. Neither selection nor `warn`/`block` authenticates a caller or owns a
worktree; use ordinary separate-writer discipline.

## Make and publish an explicit change

Follow [workspace helpers](M1-CLI.md#explicit-git-workspace-helpers): explicitly
prepare a requested task worktree, inspect it, select it in Pi, edit, verify,
commit exact literal paths and non-force publish. No helper starts a flow or
creates a request automatically. For an existing task, for example:

```sh
mypi workspace verify --project org/project --base /clones/project --worktree /clones/project--task --branch task/example
mypi workspace commit src/example.ts --project org/project --base /clones/project --worktree /clones/project--task --branch task/example --message 'Implement example'
mypi workspace publish --project org/project --base /clones/project --worktree /clones/project--task --branch task/example --remote origin
mypi workspace cleanup-preview --project org/project --base /clones/project --worktree /clones/project--task --branch task/example
```

The project owns tracked/staged `.mypi-checks.json`; mypi's version lists the existing
`mise exec -- pnpm build` and `mise exec -- pnpm verify` argv commands. See the
[exact format and limits](M1-CLI.md#project-checks-and-convenience-freshness).
Missing checks refuse, not silently pass. The per-worktree cache covers content,
including new files/config/lockfiles: later changes make it stale, while an exact
content-equivalent commit needs no redundant suite. External environment/toolchain
and ignored outputs are not attested; reverify relevant changes there. A green
cache is not authorization to publish or merge. Inspect partial results/local and
remote refs before another action; never blindly retry uncertain publication.

Cleanup is **preview only**, always manual-review, never deletion permission. It
reports tracked/untracked/ignored material and known card hints; unknown/unique or
unpublished material must be preserved. Add `--remote origin` only to request an
observation of that push destination's exact branch; omission avoids remote contact.
An equal remote HEAD does not publish dirty files. Missing/stale/closed cards do
not prove writer absence. No auto-kill, branch deletion or `clean -fdx` is provided.

## Home and optional collaboration

- **Home:** [managed writes](HOME-WRITER.md) require an already configured private
  home on `main`, clean and matching `origin/main`. The bounded Linux advisory lock
  coordinates participating CLI/MCP clients, exact paths and byte preimages, not
  direct editors. Use `mypi home document-patch <path> <text> --expected <SHA256>`
  for an existing tracked ordinary document; managed/immutable/append-only material
  uses its own APIs. On conflict or lost response, preserve changes and inspect
  `mypi home status` (MCP `home_status`). `mypi home reconcile` only clears a proven
  already-published marker; it never repeats append/commit/push. Unknown outcomes
  block participating home writes, not other projects. Status/reconcile can contact
  the remote. Do not delete lock/pending files or run direct maintenance concurrently.
- **Cards/Herdr:** `mypi session list --all` and `session show <key> --all` inspect
  [observations](SESSION-CARDS.md), not process ownership. Running → settled idle
  and normal closed are observed states; stale/unknown is not death. Archive hides
  one card, never history. Herdr is optional: add `--herdr-tab --title 'Task'` to
  the launch command above to submit a tab; `mypi session focus <key> --all` focuses an existing one,
  not resume. Submission is not readiness. Known worktree observations require
  focus, another worktree or explicit `--allow-observed-session`, not automatic kill.
- **Messages:** `mypi message send <instance-key> <message-id> 'text'` addresses the
  observed native ID; `message show <native-session-id> <message-id>` inspects the
  [mailbox](MAILBOX.md). `queued` is saved, `handed-to-pi` is a synchronous handoff,
  not read/executed/persisted. `uncertain` is never blindly reinjected. Delivery uses
  `nextTurn`, `triggerTurn:false`: no idle-agent wakeup, and pending in-memory text
  can be lost on quit/switch. Replies are separate; origin labels grant no authority.

## Disable without deleting data

For optional observation/receiving alone, use `MYPI_SESSION_CARDS=0` and/or
`MYPI_MAILBOX_RECEIVE=0` on the next start. These do not disable context, guards or MCP.

To disable the shipped extension, quit its running Pi normally first. In the
settings that own the existing package entry, change **only** its `extensions`
filter to `[]`, preserving other fields and unrelated entries. If it was a string,
use the object form with the same source. Example fragment, not replacement settings:

```json
{"packages":[{"source":"/path/to/mypi/integrations/pi","extensions":[]}]}
```

This is Pi 1.0.4's package-resource filter ([public packages documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md));
check the installed version's docs for later releases. Skills remain independently
configured. Inspect any other explicit extension entries and any independently
configured `mypi` MCP server: package filtering does not remove a file-configured
server. Change only the intended configuration, never silently erase overrides.

Restart **directly** with ordinary `pi` from the saved cwd, e.g.
`pi --session /path/to/session.jsonl`. Stop using the `mypi pi`/`pnpm pi` shortcut:
it explicitly adds `--extension` and is not disabled by a package filter. Likewise
`mypi pi -- --no-extensions` still explicitly loads mypi; native Pi keeps explicit
`-e` entries even with that flag. Plain `pi --no-extensions` without `-e` is a
broader one-run bypass that also disables built-in extensions such as MCP.

Confirm loaded resources, `/mcp`, tool inventory and normal native history/editor
behavior; missing mypi status alone is insufficient. Normal shutdown closes the
current card and clears its timers; abnormal termination may leave stale cards.
Do not delete cards/mailbox/history to make disable appear successful. Inspect
unfinished home work with `home status` before further writes. Disabling is not
rollback, automatic marker recovery, DB downgrade or a native-history migration.

## Assembly audit and acceptance boundary

Audited at epic baseline `633da8a` (MP-13 merged); MP-14 changes documentation only.
“Verified” below names prior evidence, not a fresh execution of every route.

| Slice | Kept / simplified / removed | Verified evidence and remaining limit |
| --- | --- | --- |
| MP-6 | Corrective `468912e`, [PR #11](https://github.com/yokeloop/mypi/pull/11), removes unused product executor and sole test; test isolation kept | Original PR #9 is historical command-sandbox evidence, not current Pi acceptance. No optional product sandbox retained. |
| MP-7 | [PR #12](https://github.com/yokeloop/mypi/pull/12) replaces authority core with context, strict YAML v2, Git association, validate/explain | YAML/context tables and real Git membership fixture; old PR #10 green does not establish replacement readiness. Principals/capabilities/leases/attenuation and preview removed. |
| MP-8 | [PR #13](https://github.com/yokeloop/mypi/pull/13): native launcher/branch entries; canceled uncommitted SDK-host draft excluded, history retained | Prior native persistence/reopen, lifecycle/MCP RPC and launcher terminal probes; empty conversations remain nondurable. Draft build OOM was not successful acceptance. |
| MP-9 | [PR #14](https://github.com/yokeloop/mypi/pull/14): supported write/edit and membership checks, explicit Git helpers, not shell interception | Prior real native own edit/write and base/foreign/symlink refusals; Git fixture preserves undeclared files. No adversarial containment. |
| MP-10 | [PR #15](https://github.com/yokeloop/mypi/pull/15): one advisory lock and pending observation around existing writes, not a writer daemon | Real lock/process and local-Git fixtures cover coordination, preimage conflicts, uncertain push and reconciliation without replay. Direct writes remain uncoordinated. |
| MP-11 | [PR #17](https://github.com/yokeloop/mypi/pull/17): optional instance cards, native lifecycle and explicit Herdr controls | Prior visible genuine-history reopen and two simultaneous chats/title/focus/normal exits; separate scenarios, not reopen-while-other-chat-active. No exclusive ownership or transcript purge. |
| MP-12 | [PR #18](https://github.com/yokeloop/mypi/pull/18): local mailbox and native handoff, no broker/agent launch | Prior visible no-model receiver handoff and separately one real native MCP sender-refresh turn. Not a second model consuming the message or durable nextTurn delivery. |
| MP-13 | [PR #19](https://github.com/yokeloop/mypi/pull/19): existing commands + content cache + cleanup preview, not a flow runner | Final parent build/verify 64/64 and real Git fixture; incomplete-check/index defects corrected. Preview cannot authorize deletion; no task CI checks were reported. |

Source/manifest audit found no Pi SDK host, custom Pi TUI, broker, custom transcript
store or authoritative session-ID/runtime database. Pi's SDK is a host-supplied peer
for the extension, not a core runtime dependency. Existing dependencies have concrete
users: `yaml` parses bounded configuration, MCP SDK + `zod` serve stdio/schema
contracts, `better-sqlite3` serves existing records, and `ink`/`react` serve the
separate bootstrap dialog (not a replacement Pi UI). TypeScript/types and
dependency-cruiser support strict build/module checks. Linux `/usr/bin/flock` supplies
the home advisory lock; Git and optional Herdr remain ordinary executables. No new
package/lock dependency was added by the cooperative replacements. No product
isolation, durable message-processing guarantee, automated recovery/merge/cleanup or
multi-device coordination is delivered; those require separate decisions.

The test budgets/admission remain those of [TESTING](TESTING.md). The earlier MP-9
fixture added `/bin` as an alias to already read-only `/usr/bin` for native Git;
this is not a claim that runner bytes never changed across the epic. MP-14 adds no
runner, suite or limit change. Static/source checks and spies do not establish UX.

**MP-14 parent acceptance:** the initial documentation candidate passed build and
mandatory verify, 64/64 (44 fast + 20 boundary). Separate bounded real Pi 1.0.4
acceptance followed the [visible bench procedure](TESTING.md#interactive-acceptance-through-herdr).
The completed two-phase probe resumed the same genuine **unrestricted** conversation
with the package enabled, quit normally, filtered only its extensions, then reopened
through ordinary Pi and quit normally again. Public mypi tools changed 49 → 0 and
its registration disappeared, observed through a separate diagnostic extension;
native `/session` and unsent editor input worked. Enabled heartbeat advanced and
its card closed; a six-second disabled interval showed no new card/mailbox writes. History bytes, disposable SQLite, separate context Git and an
uncommitted draft were preserved. No provider, tool call or credentials were used;
the expected no-auth model warning was not a connection error.

This is combined evidence, not one all-green probe: a separate enabled-menu readback
showed mypi connected but clipped the tool count; a final disabled-menu supplement
rendered “No MCP servers configured” and exited normally with preserved state.
Earlier wait/setup and clipped-screen matcher failures remain in the execution
record, not product-defect or normal-exit evidence. No real pending home transaction
or message was simulated. Prior unchanged-route evidence above covers project guards,
home conflicts and messaging; this final smoke does not claim to rerun them.

## Delivery is not activation

Exact final-revision checks, publication receipts and independent review remain
delivery gates; the acceptance observations above are not activation. Task
publication goes only to the epic; final delivery is
**one epic-to-main PR** for user acceptance, not its merge. Retain historical
reports and branches; do not relabel canceled attempts as successful tests.

Only after separate authorization and merge, follow the existing
[clean ff-only update route](../README.md#updating-without-overwriting-customizations):
locked dependencies/build, reload/restart and diagnostics. Explicitly review the
intended package/configuration selection. Do not copy candidate files, reset the
installation, change global Pi settings incidentally, release, migrate personal DBs
or rewrite native history. Preparation and a published PR authorize none of these.
