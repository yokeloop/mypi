# MP-5 — A1 implementation checkpoint

Architecture A1 and its implementation plan are approved: standard interactive Pi,
a thin extension and whole-process isolation, with useful tools inside authorized
resources. Disabling tool classes is not isolation. See
[resource contract](MP-5-RESOURCE-CONTRACT.md) and
[prototype](../experiments/mp5-a1/README.md).

This checkpoint is not a deployed flow runtime, security acceptance or task completion.
Review, merge permission and completion remain separate gates. The engineer clarified
that other tasks must not gate MP-5. Continue from this branch's existing committed
baseline (`6d4ebec`, based on `7ff3703`), without waiting for, importing or committing
other tasks' dirty changes. This supersedes the earlier proposed baseline dependency.

Next: implement P1, the managed local launch and durable request/run/session binding,
with Herdr orchestration, whole-process isolation and fixture external operations.
The approved A1 plan and its remaining verification/delivery gates are unchanged.

## Verified feasibility, including failures

- Five initial bounded launches established native operations, selected scope denials,
  the real Pi → codemode → MCP pipeline using a deterministic offline provider, actual
  persisted history resume, keyboard exit and cleanup of an observed child process.
  The complete trace has **11 nested tool calls**, not the historical hard-coded label 10.
- Slash-only activity did not materialize a transcript: allocated session ID and saved
  history must be represented separately. Wrapper detection was insufficient for an
  authoritative Herdr request/run/session binding.
- Four P0 follow-ups found a genuine resize defect: the PTY shrank from 188 to 113
  columns while Pi's renderer stayed at 188. `setsid --ctty` failed with EPERM.
- Preserving the **distinct systemd-owned PTY session**, instead of adding bwrap
  `--new-session`, yielded matching PTY and renderer widths 188 → 113 → 188 with
  SIGWINCH observed. Existing namespace/capability/cgroup boundaries remained, and
  the full offline tool pipeline passed again. This is not a terminal-security proof.
- A controller pager mistake delayed a stop until the 55-second service deadline.
  The observed timeout/TERM cleaned up the service/cgroup/canary child. A separate
  main-process SIGKILL run also cleaned up. The deadline case is **not** a passing
  routine manager-stop test. Readiness-chain and echoed-marker mistakes are retained
  in the private report rather than rewritten as success.

All launches used 2 CPU, 1 GiB, zero swap, 64 tasks, a 55-second runtime plus 5-second
stop bound, sequentially under the exclusive test unit. P0 wall times were 22.137,
0.178, 55.164 and 1.318 seconds. No limits were raised and no live model requests or
credentials were used. Temporary fixture trees, runtime copies and owned panes were
cleaned up. These are individual observations, not benchmarks or latency percentiles.

## Subsequent routine-stop check

After the first MP-5 commits were pushed, one additional run exercised ordinary
`systemctl stop` through an owned Herdr controller pane, not the emergency deadline.
The source was commit `07cbf7d`; no launcher/probe code changed for this check.

- Fresh service/Pi TTY identity was checked; the native/helper scope checks passed.
- The canary was observed alive and verified in the owned service's cgroup.
- The current InvocationID was checked immediately before a no-pager stop command.
- Stop returned successfully: manager result `success`, main signal `15/TERM`, service
  runtime 1.245 s, CPU 1.093 s. Before stop, memory.peak was 260,378,624 bytes and
  pids.peak was 36; final service summary reported 248.3 MiB. No limit changed.
- Afterward the service was inactive/dead, cgroup and canary absent, foreign/read-only
  canaries unchanged. Owned panes and temporary fixture data were removed.

This establishes observed routine-stop cleanup, not host-crash recovery, atomic grant
revocation or task acceptance. Raw evidence: managed `p0-routine-stop-v1.json`.

## Traceability

Detailed report and raw evidence remain in the managed MP-5 context. Key artifacts:

- `a1-prototype-report-v1.md`, `a1-prototype-summary-v1.json`;
- `a1-offline-pipeline-v1.json`, `a1-resume-terminal-v1.txt`;
- `p0-results-v1.md`, `p0-terminal-evidence-v1.json`, `p0-offline-pipeline-v1.json`;
- `p0-sources-v1.json`, `resource-contract-v1.md`;
- `architecture-a1-v5.html`, `derive-publication-v4.json`.

Public Git intentionally excludes private publication receipts and raw session/terminal
traces. The fixture source contains no provider keys; `non-secret-fixture` is synthetic.

## Remaining work

All signal variants, host-crash recovery and the full isolation attack set are not
yet verified. Production mypi/Derive authorization and revocation,
Git mediation, provider credential/streaming support and trusted approvals remain
unimplemented. No independent test-diff/security review has run. Do not claim that a
passing fixture establishes production scope enforcement.

Herdr discovery instructions are being delivered in this branch's `AGENTS.md`.
The shared MEMORY fact must remain until the instructions reach the canonical checkout;
then reread `memory_show` and remove only the matching duplicate through scoped mypi.
Do not delete shared guidance merely because one unmerged worktree has its replacement.
