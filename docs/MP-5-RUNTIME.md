# MP-5 — interactive task runtime

This branch implements the first A1 interactive flow: **ordinary Pi 1.0.0 in a Herdr
tab, useful tools inside a task filesystem/network boundary, host-side scoped APIs**.
It does not implement a generic scheduler or automatically generate flow definitions.
Deployment, independent security/test-diff review, merge and task acceptance are
separate from the implementation and its offline verification.

## Entry points

Run from a trusted Herdr host session, using Node 24 and the built application:

```sh
mise exec -- node dist/src/cli/main.js run start MP-42 \
  --seconds 1800 --model-calls 30 --model gpt-5.4
mise exec -- node dist/src/cli/main.js run list MP-42
mise exec -- node dist/src/cli/main.js run show RUN_ID
mise exec -- node dist/src/cli/main.js run stop RUN_ID
mise exec -- node dist/src/cli/main.js run reconcile RUN_ID
mise exec -- node dist/src/cli/main.js run start MP-42 \
  --seconds 1800 --model-calls 30 --model gpt-5.4 --resume RUN_ID
mise exec -- node dist/src/cli/main.js run export STOPPED_RUN_ID
```

**These are examples, not authorization to spend money or launch a real task.**
The caller must have explicit launch/provider authorization and choose its budgets.
The supported live provider is the host's configured `openai-codex`; credentials are
resolved by Pi's `ModelRuntime` outside the worker. No live inference or OAuth refresh
has been verified in MP-5. Offline fixtures are explicitly not LLMs.

CLI and the six `run_*` MCP tools call the same application scenarios. The normal
MCP server is a **trusted-host control surface**, not the endpoint mounted in a worker.
Do not expose it, its DB, or the Herdr socket to an untrusted process.

`run start` returns an allocated/starting attempt, not a promise of readiness. Read the
DB-backed `run show`; the service also writes a fresh host-only `ready.json` bound to
the attempt, session and InvocationID. A terminal marker is not authority. Interactive
Pi waits for a user/authorized controller prompt; starting it does not start an
unbounded autonomous loop. Its prompt points to the bound task context and project
instructions. A failed launch reports its ID: inspect before retrying.

Load `integrations/pi/task.mjs` explicitly in a **host** Pi session to add:

```text
/task {"title":"Task title","status":"planning","slug":"task-name","source":"Exact original request"}
```

It creates a card only. `project` can be an explicit `org/project` or `null`; otherwise
an existing, uniquely registered checkout is resolved. The status is supplied by the
caller and validated against the DB. No global installation/configuration is changed.
Inside a scoped worker `/task` explains that creating another card is a host action.

## Storage, ownership and restart

Schema version 2 adds `task_runs`; the v1 migration preserves existing cards/statuses.
For an explicitly authorized upgrade, stop old writers, back up with the old compatible
version, install/build this version, run `db init` to migrate, then restart clients.
Reads and ordinary writes do not silently migrate; `db init` does not create context
or authorize a personal bootstrap. No personal DB was migrated during MP-5 development.
The DB owns request/run/session/worktree/base revision, service/pane/tab/InvocationID,
current lifecycle state, and the observed transcript filename. Partial unique indexes
refuse overlapping active request, worktree and service-unit bindings.

Run states are `prepared → starting → running → stopping → stopped`, with failure
paths. They are not request statuses or an acceptance workflow. An allocated session
ID is not a persisted conversation. A crash can leave the DB's transcript field null
even when a file exists; resume checks the owned files after service reconciliation.
Stopped/failed attempts are not restarted in place: resume creates a new attempt,
retains the session/worktree binding and copies only bounded, unlinked private state.
It does not replay model requests, append operations or external publications.

Private state is next to the DB in `runs/RUN_ID/`: launch binding, task context,
agent/session/private Git, runtime projections, sockets and operation receipts.
Do not publish it. Existing backup/restore covers the DB and managed context, **not**
project worktrees/private runtime files. Restored DB records do not resurrect services;
keep runtime files separately if their recovery is required. Never clean up solely
because a socket filename exists or a tab is gone.

## Isolation and working tools

- Herdr creates the tab in a trusted control directory, **not the mutable checkout**.
  This avoids host shell directory hooks and prompt Git helpers on worker-controlled
  files. The worker itself runs at `/work`.
- A dedicated systemd PTY/cgroup owns the service and descendants. The service verifies
  MainPID/InvocationID and a different TTY from its host shell. Bubblewrap preserves
  that dedicated terminal session, with separate mount/PID/network/user namespaces,
  dropped capabilities and no new user namespaces. Missing prerequisites fail closed.
- Native read/bash/edit/write, nested codemode and MCP remain usable. Writable mounts
  are the assigned worktree and private agent state; context/runtime are read-only.
  There is no host home, DB, credentials, general network, D-Bus/Herdr socket, shared
  Git metadata or unrestricted HTTP proxy in the worker. `/usr` is the trusted OS image.
- New worktrees contain committed blobs only: no copying dirty source files, checkout
  hooks or filters. The initial tree is limited to 10,000 entries / 31 MiB of blob data;
  submodules, unsafe symlinks, shared hardlinks and special files are rejected.
- Build dependencies are not implicitly copied from an unrelated dirty checkout or
  fetched through unrestricted networking. The first flow has no package-download
  gateway; an unavailable dependency is an explicit limitation, not a bypass license.

Runtime and export units use 2 CPU, 1 GiB RAM, zero swap and 64 tasks. The operator
supplies the task lifetime (10..86400 seconds) and provider call budget (1..1000).
Exports have a 55-second deadline. The fixture uses only the exclusive
`mypi-tests.service`, at most 55 seconds; never overlap it with verification.
These are resource bounds, not latency percentiles or a disk quota.

## Scoped external operations

The worker's Unix listener binds authority on the host, before dispatch. It offers
only its own card/history, permitted inherited context/task artifacts, and task
progress. Client scope IDs, arbitrary file input, global journal, status/acceptance,
bootstrap/restore, host controls and arbitrary MCP resources are denied. Calls are
serialized and recheck the active grant when dequeued. Stop revokes before signalling.
Already-dispatched external effects may complete; revocation is not rollback.

An optional explicit Derive grant is supplied at launch:

```text
--derive-artifact SHORT_ID --derive-workspace WORKSPACE_ID
```

The adapter offers only `derive_read`, artifact-specific `derive_catch_up`, and exact
small `derive_publish` edits with a required `base_version`. It fixes the artifact and
workspace on the trusted side. No global queue/search, generic code, token minting,
sharing changes, arbitrary resources or stage/upload capability is exposed.
The HTTP connection is discovered from the host Pi's `derive` MCP entry; header auth
and environment substitutions are supported. OAuth-only or command-generated MCP
auth is rejected explicitly in this first adapter. Its live transport is not covered
by the offline fixture. Pre-dispatch/returned/uncertain receipts are private; after a
failure inspect the artifact and receipt instead of blindly repeating a publication.

The provider relay likewise selects the model and limits on the host. The worker sees
public model metadata and a placeholder, never real access/refresh credentials. Abort,
connection loss and revocation have no direct-network fallback. Offline verification
exercises the actual Pi dispatcher/protocol but does not establish live compatibility.

## Git and delivery

Normal Git status/diff/add/commit operate on a **private repository** in the worker.
It initially contains only the selected commit/tree, not other refs, history, hooks,
configuration or credentials. It survives resume. Shared host `.git` is masked by a
read-only pointer to this private repository.

After stop/reconciliation, `run export` runs in a bounded service. Worker Git is read
inside another namespace, never executed with its configuration on the host. Only
pack object data is imported; host-side ancestry checks and a compare-and-swap update
advance one assigned branch and its index. The registered checkout's branch/index are
not switched. A partial import may leave unreachable objects; reconcile the ref/index
before retry. Export does **not** push, create/merge a PR or accept the request.

For MP-5 itself the authorized delivery order remains commit + review-ready PR →
engineer review/merge approval → merge → request completion. Broader/future unit
acceptance is defined by its chosen flow, not by a global human-only rule.

## Verification and limits

See [verification record](MP-5-VERIFICATION.md), [resource contract](MP-5-RESOURCE-CONTRACT.md)
and [testing policy](TESTING.md). Maintained checks include the migration, state/scope
matrices, real context writes/revocation, Git hooks/filters and linked-file denials.
Build checks syntax and freshness of runtime-loaded `.mjs` integrations as well as TS.
The SDK 1.32 patch changes **only** an incorrect optional `sessionId` declaration;
`exactOptionalPropertyTypes` and architectural/admission rules remain enabled.

This is not protection from an administrator or another trusted host actor with the
same user's unrestricted access. Full adversarial terminal/kernel/race coverage,
physical host-crash recovery, live provider/Derive authentication and independent
security/test-diff review are not established. No fixture, transcript or exit code
stands in for those gates or engineer acceptance.
