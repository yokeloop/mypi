# Native session observation cards

The runtime cache is a small, rebuildable inventory of observations, **not** an
identity/ownership registry, process manager, transcript store, lock or ACL.
Pi owns native session IDs, history and branch working context. Each producer
instance gets a fresh UUID key, including when reopening the same native session.
PID and optional Herdr tab ID are hints only. This foundation does not itself
install lifecycle hooks, timers or Herdr operations.

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
those require separately approved actual native acceptance.
