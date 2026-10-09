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
optional MP-8 WorkContext, nativeSessionFile, title, pid and herdrTabId, observed
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
