# MP-5 — verification record

## Test admission

Existing cheap DB, CLI/MCP schema and request tests were extended rather than duplicating
all inputs through processes. New fast tables protect durable run transitions, active
uniqueness, task-status independence, strict local grants and artifact-specific Derive
commands. Real Git boundaries are needed to detect hook/filter execution, dirty-source
copying and linked-file handling. The application boundary uses real temporary context,
SQLite and Git to prove owned writes, foreign-data preservation and queued-call revocation.

The runtime-loaded Pi `.mjs` files now receive build syntax checks and participate in
build freshness; the test sandbox copies those inputs. No admission rule, concurrency,
resource limit or mandatory profile was relaxed. A two-line declaration-only SDK patch
fixes HTTP Transport's optional sessionId typing without enabling skipLibCheck.

## Observed checks

- Full `build` + `verify`: **18 fast + 14 boundary**, all passing. Latest recorded
  full profile before documentation: wall 7415 ms; fast 164 ms; memory.peak
  411,398,144 bytes; pids.peak 50. These are individual measurements, not p95.
- Two mutations in a disposable copy: removing context-scope enforcement and allowing
  a stopping grant. Both failed the intended existing assertions (`Missing expected
  exception`), not setup/import. Their bounded service times were 1.224 / 1.185 s.
  The real source was not mutated; the normal full profile subsequently passed.
- Eight sequential **product** fixture launches, separately from the historical P0
  prototype. The latest uses ordinary Pi → codemode → native tools and the scoped
  MCP listener, with private Git and fixture Derive. It executes **14 nested tool
  calls**, plus four raw JSON-RPC probes inside one of those shell calls.
- Useful write/edit/read/bash/Git, owned card/progress and Derive read/versioned edits
  passed. Native reads of `/etc/passwd` and `/proc/1/root/etc/passwd` were denied.
  Raw socket probes bypassed Pi's schemas: owned card read passed; foreign card,
  forged acceptance and arbitrary MCP resource read were denied on the host.
- Resume sent **two previous successful pipeline results** to the host fixture;
  this is actual reconstructed model context, not just an allocated session ID.
  The same private Git state and assigned worktree were retained.
- Routine manager stop after the expanded pipeline: service runtime 1.708 s,
  CPU 2.302 s, final memory 307.4 MiB; inactive service and empty ControlGroup.
- Final product fixture: observed memory.peak **327,938,048 bytes**, pids.peak **60**.
  A detached canary was observed alive among owned cgroup processes. Main SIGKILL
  yielded `signal`, `9/KILL`, service runtime 1.791 s, CPU 2.472 s; service/cgroup
  and canary were absent afterward. `reconcile` changed the stale attempt to failed,
  without changing request acceptance. This is process-death recovery, not a power-cut test.
- Private commits were exported after routine stop and after crash reconciliation.
  Successive exports advanced only the assigned fixture branch; no network/push/merge
  was performed. The fixture's registered checkout remained on its original commit.
- Pi ModelRuntime's constructor and getModel/streamSimple methods were exercised with
  empty temporary auth; the fixture made **no paid inference or real Derive trial writes**.

All runtime experiments used the exclusive unit at 2 CPU / 1 GiB / zero swap /
64 tasks / 55 seconds + 5 seconds stop. The separate offline dependency-patch install
used the existing installation budget, completed in 93 ms and downloaded no packages.

## Failures retained, not rewritten as success

1. Fixture setup passed a project code instead of org/project identity; DB inspection
   preceded repair, so no duplicate card was created.
2. The ambient shell selected Node 26 in the first product attempt. Runtime launch now
   requires Node 24. That attempt also exposed Herdr's empty successful pane.run reply
   and a readiness signal swallowed by Pi RPC stdout handling. Readiness moved to an
   atomic host-only PID-bound file; no timeout was raised.
3. The worker custom provider lacked a required baseUrl. Its configured placeholder
   URL is deliberately unusable; actual traffic remains on the Unix relay.
4. A controller searched only the bottom terminal lines and missed readiness.
5. On resume, the controller matched an old success message and stopped early. The
   new fixture also needed to recognize schema rejections as thrown errors, not only
   isError results. Existing useful effects before the failure were preserved.
6. A later readiness search missed the notification above restored long history; no
   new prompt was submitted. Fresh host attempt readiness and a unique final marker
   replaced transcript matching as the control mechanism.
7. Strict compilation exposed the SDK declaration defect. Admission then correctly
   rejected protocol imports outside the boundary. The transport moved to `src/mcp`,
   with an injected application port and pure validation; the checker was not changed.
8. Admission rejected a dynamic-import `/task` test. Its pure command adapter was
   extracted to the CLI boundary and tested through a static import, preserving the
   same runtime handler and exact-source/card-only assertions without weakening admission.

## Remaining gates

No independent test-diff/security review has run. Live provider streaming/OAuth refresh,
Derive authentication, broader adversarial terminal/path races and physical host-crash
recovery are not certified by these checks. No general dependency-download channel is
implemented. No new production deployment, personal DB migration, merge or task
completion is claimed.

Private raw evidence, receipts and detailed failure records are kept in the existing
managed MP-5 context, not in this public repository. The historical P0/prototype results
remain documented separately and are not relabelled as tests of the product runtime.
