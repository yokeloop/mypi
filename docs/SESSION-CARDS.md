# Native session observation cards

The runtime cache is a small, rebuildable inventory of observations, **not** an
identity/ownership registry, process manager, transcript store, lock or ACL.
Pi owns native session IDs, history and branch working context. Each producer
instance gets a fresh UUID key, including when reopening the same native session.
PID and optional Herdr tab ID are hints only. The shipped Pi extension observes
native lifecycle events; it does not perform Herdr operations.

## Storage and observations

`MYPI_SESSION_DIR` selects an absolute cache directory. When absent, the default is
`$XDG_STATE_HOME/mypi/sessions`, or `~/.local/state/mypi/sessions` without XDG state
configuration. An explicitly empty/relative override is an error. Existing ancestor
aliases are resolved; engine and context repository containment is rejected. These
are cooperative filesystem checks, not race-resistant containment. Invalid path
configuration/canonicalization fails before constructing the cache API; later
cache observation failures are reported as issues. Missing reads
create nothing: no cache directory, database, home Git or repair operation.

`cards/<instanceKey>.json` contains version 1, instanceKey, nativeSessionId, cwd,
optional MP-8 WorkContext, nativeSessionFile, title, pid, herdrTabId,
herdrPaneId and herdrSocketPath, observed
state, startedAt and lastSeen (integer epoch milliseconds). The native file is only
an observed pointer: an empty native conversation might not have been persisted.
No command reads, copies, deletes or modifies native history. Malformed stored
context is invalid, not a reason to revive a previous project selection.

The producer writes only its captured key with atomic replacement, at most 32KiB
per card. A closed producer ignores later callbacks. Different keys isolate old
instances from new ones; this is not fencing or exclusive runtime ownership.
Writes use private directory/file defaults. A list visits at most 1000 directory
entries without allocating an unbounded directory array. At the bound it reports
`truncated:true` conservatively, even if the directory happens to end there.
Invalid/unavailable observations appear in `issues`; an inventory with issues or
truncation must never be used to conclude there is no duplicate. There is no purge,
retention schedule, automatic cleanup or database initialization.

Pure transitions are start → starting, running → running, settled → idle,
heartbeat → same observed state, close → closed. Each update records the injected
clock. Views include `{card, archived, ageMs, status}`. A valid clock reports stale
only when age is **greater than 90000ms** by default; a closed observation stays
closed. A future timestamp or invalid clock reports unknown with null age.
Stale/unknown does not prove process death, transfer rights or authorize a kill.
Staleness is a display threshold, not a lease, heartbeat SLA or guarantee of delivery.

`archives/<instanceKey>` is a separate empty marker. Archive is idempotent and
hides only that instance from ordinary lists. Producer updates never touch the
marker, so later heartbeat does not unarchive it. Unexpected marker types are
invalid observations. Archive is **not transcript deletion** and does not close Pi.

## Native lifecycle producer (Pi 1.0.4)

The shipped entrypoint registers observation after MP-8 working-context hooks, so
fresh launch handoff is visible before the first card. Every `session_start`
(startup/reload/new/resume/fork) creates a fresh instance, including reopening the
same native session. A startup-only `isIdle() && !hasPendingMessages()` sample
initializes a ready prompt as idle; otherwise it remains starting. That sample is
not an `agent_settled` event or proof of future quiescence. During activity,
`agent_start` records running and only `agent_settled` records final idle.
`agent_end` does not mark completion, and heartbeat never polls for settlement.

`session_tree`, `session_info_changed`, `before_agent_start`, and activity events
refresh the complete plain snapshot from the current native branch and readonly
session ID/file/name. Missing/invalid selection or a cleared title removes the old
value, rather than reviving a previous project. Tree/title updates keep the same
instance and activity state. A mismatched native ID disables the old producer.
Heartbeat retains no native context/session manager: it writes only the latest
plain snapshot captured by synchronous native events.

`MYPI_SESSION_CARDS` absent or `1` enables the optional producer; `0` disables it
without constructing a cache or timer. Other values are invalid.
`MYPI_SESSION_HEARTBEAT_MS` defaults to `30000`, accepting only canonical decimal
integers from `5000` through `60000`. Invalid configuration warns and disables
observation for that session start; it does not silently use a fallback interval.
Staleness remains the independent 90-second display threshold above, not an SLA.

No timer or cache write starts in the extension factory. A successful native start
owns one unref'ed interval. Replacement and `session_shutdown` clear it and close
only that instance; repeated cleanup is harmless and obsolete timer callbacks do
nothing. Optional cache failures clear the timer, release notification callbacks
and disable that producer until a later session start/reload. They warn at most
once per affected instance, never make ordinary Pi depend on cache/Herdr, and do
not fabricate a successful close after failed observation. Existing cards can
therefore become stale. SIGKILL/power loss need not emit shutdown; neither PID nor
missing heartbeat proves death, containment or exclusive worktree ownership.
Disabling/removing the extension does not delete cache cards or native history.

## CLI and MCP

```text
mypi session list [--project org/project | --all] [--archived]
mypi session show <instance-key> [--project org/project | --all]
mypi session archive <instance-key> [--project org/project | --all]
```

MCP names are `session_list`, `session_show`, `session_archive`. Inputs use
`project`, `all`, `instanceKey` and (list only) `includeArchived`. Inputs/results
are strict; list/show are read-only, archive is an idempotent cache-only write.
No route contacts Herdr or the network, or depends on managed home publication.

Without an explicit filter, the current concrete project selection is used
(selectedProject, otherwise project scope). If none exists, choose `--project`
or `--all`; organization/unrestricted/no context never silently means global.
Explicit project and `all:true` are mutually exclusive operator-selected views,
not registry-verified membership or new access controls. Unselected cards are
visible in `--all`. Explicit-key show/archive can access already archived cards.

- List: `{sessions, issues, truncated}`; descending lastSeen then instance key.
- Show: `{session}` or `{session:null, issue}` where issue is missing, invalid,
  unavailable or outside-selection.
- Archive: `{instanceKey, archived:true}` after validating the selected card;
  otherwise an ordinary error. Native history remains untouched.

## Application seam and evidence

`src/app/session-cards.ts` exports `createSessionCards`, `executeSessionCommand`,
`resolveSessionDirectory`, `parseSessionCard` and shared types. Composition accepts
an injected env/home/contextRoot/clock/staleMs. `start(observation)` returns an
immutable instance key and `update(event, observation?)`; a supplied observation
replaces the whole observed selection, rather than merging stale context. Use
`update('close')` for idempotent cleanup. A failed close write still closes that
producer locally. Optional integrations must handle cache failures without making
ordinary Pi depend on the cache. No resources start on module import.

The controlled-clock table and disposable filesystem fixture protect state/age,
key isolation, archive-after-heartbeat, bounds, invalid observations, selection and
native-file preservation. Literal adapter/discovery tests and existing CLI/MCP
boundary canaries protect routing without DB/home setup. These checks are not
native extension-load, provider-activity, persistence/resume or Herdr evidence;
those require separately approved actual native acceptance. The lifecycle fixture
also uses a controlled scheduler with actual disposable card files to protect
startup idle versus settlement, snapshot clearing, one timer, replacement/late
callbacks, idempotent shutdown and failure disabling. It emits no real Pi events
and makes no provider-activity claim. Core tsc excludes shipped extension sources;
actual native extension-load evidence must be recorded separately.

## Explicit launcher choices and optional Herdr (0.8.2)

`mypi pi` inspects nonclosed observations for the exact prepared canonical cwd or
worktree root, **including archived observations**. Existing observed directories
are canonicalized too, so symlink spellings match. Unresolvable observed paths make
the inventory incomplete rather than proving there is no duplicate. Known starting/running/idle,
stale or unknown cards require a choice: `mypi session focus <key> --all`, another
verified `--cwd`, or explicit `--allow-observed-session`. This override does not
bypass repository verification or native guards. Missing/unavailable/invalid or
truncated cache warns and does not block an otherwise ordinary launch. An empty
inventory never proves exclusive use. Direct native Pi remains a documented bypass;
there is no lock, lease, kill, transfer or automatic worktree creation.

```text
mypi pi [existing launcher options] [--allow-observed-session] --herdr-tab [--title text] [-- native arguments...]
mypi session focus <instance-key> [--project org/project | --all]
mypi session title <instance-key> <text> [--project org/project | --all]
```

These are explicit **CLI terminal controls**, not MCP data tools. Ordinary launch
keeps native terminal IO/status and needs neither Herdr nor its executable.
`--title` requires `--herdr-tab`; neither launching nor heartbeat automatically
creates, focuses or renames a tab. Title changes the Herdr label, not native Pi
history/title. Focus never implicitly resumes/forks/starts a native conversation.
Typed application controls accept the same legitimate current-project context or
explicit project/global view as card inspection. The standalone CLI has no current
native branch context and requires explicit `--project` or `--all`; it never
interprets the fresh-launch MYPI_PI_CONTEXT handoff as current selection.

The producer optionally captures `herdrSocketPath`, `herdrPaneId` and `herdrTabId`
from valid inherited managed-pane context. These are observations, not credentials
or ownership. Old tab-only cards remain viewable but cannot be controlled. Explicit
control requires `HERDR_ENV=1`, a normalized absolute `HERDR_SOCKET_PATH` and safe
opaque caller IDs. `pane current --current` must match caller pane/tab/workspace;
a moved/stale caller must be refreshed, never replaced by the UI-focused target.
Target lookup uses the recorded pane and tab on the **same socket namespace**, and
checks their association. Explicit cross-workspace targets on that server are valid.
No IDs are derived from prefixes, list order or UI focus. A socket path is not
server incarnation attestation; these remain cooperative usability checks.

New-tab launch prepares the cwd, caller-selected absolute Pi executable and native
arguments before effects. It creates a tab in the verified caller workspace with
`--no-focus`, uses the **returned** root pane, and submits one POSIX-compatible
quoted command (`cd` to the prepared directory, then `/usr/bin/env` and absolute
Pi/shipped extension). Native arguments, including quotes, remain single tokens.
The pane shell must support POSIX quoting; no general shell parser is implemented.
A supplied title is a bounded plain label. No recursive launcher or custom Pi host
is used; existing-session context and native history precedence stay Pi-owned.

Only PATH, HOME, XDG_CONFIG_HOME, XDG_CACHE_HOME, XDG_STATE_HOME, XDG_DATA_HOME,
PI_CODING_AGENT_DIR, MYPI_SESSION_DIR, MYPI_SESSION_CARDS,
MYPI_SESSION_HEARTBEAT_MS, MYPI_MAILBOX_DIR, MYPI_MAILBOX_RECEIVE,
MYPI_MAILBOX_POLL_MS and MYPI_GUARD_POLICY are explicitly transferred (unset
when absent). See [MAILBOX](MAILBOX.md) for mailbox configuration.
MYPI_PI_CONTEXT is cleared and then set only to the prepared context.
Herdr socket/pane/tab/workspace variables come from the **new** pane, not the caller.
This is not full environment cloning: arbitrary caller-only provider/extension
variables are not forwarded. Pi's usual credential storage stays Pi-owned. The
adapter never logs the assembled command/environment, native arguments or raw
Herdr stderr. There are no new credentials, providers or service processes.

Successful open returns `{status:'submitted',herdrSocketPath,tabId,paneId}`;
focus/title return `{status:'focused'|'renamed',instanceKey,tabId}`. JSON-producing
create/lookup/focus/rename require typed positive acknowledgements, never an empty
stdout fallback. The exact Herdr0.8.2 `pane run` command instead waits for its server
response and then exits0 with **empty stdout**: submission requires that specific
CLI receipt, not fabricated protocol JSON. Unexpected output/nonzero/timeout
remains partial. These results do not attest Pi readiness or rendered UI. Calls
bound response size and deadline. A mutating call
with lost/malformed/failed acknowledgement reports nonzero JSON
`{status:'partial',stage,herdrSocketPath,tabId?,paneId?,message}` even when no created
IDs are known. Creation and submission are separate effects: inspect the explicit
server and known IDs before another action. No automatic retry, rollback claim or
tab deletion occurs.

The cheap injected-runner tables protect command mappings, namespace/association
checks, cross-workspace targets, quoting and partial reports. They do not prove
live Herdr syntax, pane shell execution, two actual chats, rendered UI or provider
activity. Actual native/Herdr acceptance is separate parent-owned disposable work;
headless acknowledgements and terminal buffers are not graphical-client evidence.
