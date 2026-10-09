# Local native-session mailbox

The mailbox stores small cooperative messages on **one local machine**, outside
Git and Pi history. It does not launch Pi, create tabs, authenticate senders,
change receiver context or authorize external work. Replies are separate messages.
A message from another session is not a new user instruction.

## CLI and MCP

```sh
mypi session list --all
mypi message send <instance-key> <message-id> 'text' [--ttl-ms milliseconds]
mypi message list <native-session-id>
mypi message show <native-session-id> <message-id>
mypi message cleanup <native-session-id> <message-id>
```

MCP exposes `message_send {instanceKey,messageId,text,ttlMs?}`,
`message_list {receiverNativeSessionId}`, and `message_show` / `message_cleanup`
with `{receiverNativeSessionId,messageId}`. CLI and MCP use shared application
commands; these routes do not open/create the DB or home/context repository.

Send resolves the explicitly selected MP-11 **instance observation** into its
Pi-owned native session ID. Stale, closed and archived observations are usable;
none proves that a process exists or is reachable. Several instance observations
can address the same native mailbox. List/show/cleanup take the literal native
ID, not the instance key. Direct receiver reads never scan other receivers.

The v1 immutable envelope stores message ID, literal receiver native ID, sender
`{kind:cli|native,nativeSessionId?,project?}`, optional observed receiver project,
exact text, creation time and expiry (epoch milliseconds). Ordinary native caller
metadata is not authentication. Without a supplied native caller, sender is
`kind:cli`, with **no invented native ID** or focused-tab inference. A concrete
working project, if supplied, is retained as an origin label. Explicit
cross-project messages are allowed; the envelope preserves both project labels.
Unknown projects remain omitted, not inferred from cwd or registry membership.

Message IDs are 1–128 ASCII letters/digits/dots/underscores/hyphens, starting with
an alphanumeric. IDs are unique **within a native receiver mailbox**, across all
senders. Retrying the same ID with identical sender, recipient, labels, exact text
and TTL duration returns the original record/timestamps without enqueueing again.
Changing any of those fields conflicts. Changing only the selected instance key
is fine when its resolved native identity/labels match. Retrying cannot extend
expiry. Explicit cleanup deliberately forgets this dedup evidence, allowing that
ID to be reused. If a send fails after reservation/publication, inspect first:
nonzero/error is not proof nothing was saved.

## Meaning of observations

- `queued`: saved and unclaimed, not handed to Pi. Offline receivers do not wake.
- `expired`: expiry reached (`now >= expiresAt`) while still unclaimed.
- `uncertain`: claimed, with no valid final success outcome. This includes a
  failure, session mismatch, expiry after claim, or crash before/after Pi handoff.
  It is never automatically reinjected, reclaimed or declared dead.
- `handed-to-pi`: the synchronous public handoff call returned and its outcome
  was recorded. It does **not** mean read, understood, executed or persisted in
  native history.

Invalid JSON, incomplete reservations, unavailable reads and leftover busy
markers are explicit issues, not healthy empty mailboxes. Lists include issues
and `truncated`; they are not an authoritative complete inventory. Malformed
outcomes never become success. Wall-clock changes are not delivery guarantees.

The shipped native extension uses the public call `pi.sendMessage` with
`deliverAs:'nextTurn', triggerTurn:false`, clearly labeled as another session's
message. Pi 1.0.4 queues nextTurn messages **in memory** until a later user turn;
quit or switching sessions may lose pending text even after a handoff receipt.
There is no automatic resend, model turn or exactly-once processing promise.
The receiver runs code only; no LLM polls the mailbox.

## Storage, bounds and cleanup

`MYPI_MAILBOX_DIR` overrides `$XDG_STATE_HOME/mypi/mailbox`, defaulting to
`~/.local/state/mypi/mailbox`. The path must be absolute and outside both the
engine and configured context repository, including existing symlink aliases.
No database or native transcript is used. Receiver/message directory names are
SHA-256 encodings of the **literal** IDs; hashes are path encodings, not authority.

Text is limited to 16KiB UTF-8; envelope/outcome reads are strictly bounded to
32KiB. Default TTL is 24 hours, maximum seven days, minimum one millisecond.
Observed admission thresholds are 100 retained records per receiver and 1000
receivers. Simultaneous creators can temporarily exceed those **soft** thresholds;
they are accidental-growth protection, not a quota transaction or security model.
Malformed entries and incomplete reservations count toward occupancy. Existing-ID
inspection/dedup still works at capacity. Every directory scan visits at most
1000 entries and conservatively reports truncation at the bound. Retained empty
receiver directories also count; there is no automatic expiry/pruning daemon.

A per-ID exclusive directory reserves a new record. Its complete JSON envelope
is written to a temporary file and atomically renamed inside that reservation;
a crashed incomplete reservation is never overwritten or recreated blindly.
These are ordinary local filesystem atomicity rules, not a power-loss/fsync
promise. A receiver claims exclusively before calling Pi. A small stable sibling
`.busy` marker excludes only claim admission and selected cleanup of that ID;
there is no mailbox-wide lock, wait, lease, PID test or automatic lock repair.
The marker is released before handoff. A crash leaving it is reported as
incomplete/busy; no automatic recovery action is offered.

Cleanup takes the same exclusion **before rereading** the actual record. Only a
successful handed-to-Pi record or an expired **unclaimed** record is eligible.
An uncertain claim is never eligible, **even after expiry**: expiry does not
prove its forwarder stopped. Completed handles cannot write another outcome.
A competing cleaner cannot delete a replacement queued record using an old
eligibility observation. Cleanup is one explicitly selected ID, never bulk
history deletion. Unrelated records, original source and native history remain
untouched; no technical cleanup is an acknowledgment of task completion.

## Native receiver and caller lifecycle

The shipped `mypi` extension registers a mailbox receiver after working-context
and session-card handlers. Its factory starts nothing. Each `session_start`
retires the former handle, selects the actual Pi native ID, drains once, then
starts one unreferenced interval. `session_shutdown` (including switch/reload)
retires the timer and releases the current-context getter. Late callbacks cannot
act on a replacement session, even with the same ID. Each claim and synchronous
handoff rechecks the live public `ctx.sessionManager.getSessionId()`; a mismatch
retires the receiver and any already claimed record stays uncertain.

`MYPI_MAILBOX_RECEIVE` defaults to `1`; `0` disables receiving without deleting
anything. `MYPI_MAILBOX_POLL_MS` defaults to `2000`, with strict integer values
from `1000` through `60000`. The interval is selected on session start/reload;
changing a valid interval requires another start/reload. Disabled or malformed
settings retire polling on the next tick. Each drain uses one bounded list and
at most ten queued-record inspections/claim attempts. Retained issues or
truncation are not proof of an empty or fully delivered mailbox.

Per-ID contention/invalid records are skipped with at most one warning per
receiver lifecycle. Public-call errors leave uncertain claims, never retries.
An unavailable receiver scan, configuration error or failed live-ID getter
stops polling until the next session start. There is no cleanup, lease, crash
reclaim, background agent or automatic tab launch. Messages are displayed as
`mypi.other-session` with exact text and explicit origin, observed destination
project and cross-project labels. They confer no permission and do not mutate
the receiver's selected project or prompt instructions.

Native MCP registration includes both the existing working-context envelope and
`MYPI_MCP_NATIVE_SESSION_ID`, a canonical bounded base64url encoding of the
actual native ID. Missing/empty ID means no native caller; malformed data fails
MCP startup rather than silently pretending to be CLI. Registration refreshes
on native session changes even when the working selection is unchanged. These
are ordinary claimed metadata, not authentication. A requested registration is
**not** proof that a server is connected or updated: a same-name user `mcp.json`
entry takes precedence, including `enabled:false`. Inspect `/mcp`. Independent
CLI sends still use `kind:cli`; inherited launch context or UI focus is never a
native sender source. Launcher paths clear inherited MCP caller/context values;
Herdr explicitly forwards the three mailbox configuration variables above.

## Native acceptance preparation

Follow [the visible Herdr procedure](TESTING.md#interactive-acceptance-through-herdr)
with two disposable real Pi sessions, shared disposable mailbox/cache and the
exact built candidate. Preserve actual native IDs from `/session`/observations,
not invented conversation records. Start idle, send a unique message using a
selected observation, and inspect queued versus handed-to-Pi outcomes. A native
command using the public application sender seam can exercise native addressing
without a model; a CLI send proves only CLI-to-native receiver behavior.

Observe the public `sendMessage` call/options/return independently where needed,
plus absence of `agent_start`, idle UI and unchanged native history before a user
turn. In Pi 1.0.4 `ctx.hasPendingMessages()` counts steering/follow-up messages,
**not** nextTurn custom messages; it cannot prove nextTurn queue state. Do not
inspect private queues or claim immediate rendered/persisted content. Switch or
quit normally and confirm no automatic reinjection of a handed/uncertain record.
Actual MCP sender refresh needs separate native `/mcp`/tool evidence, including
same-context session changes and possible user overrides; helper tests and a
CLI send do not prove that a native MCP connection refreshed. No provider turn
is required for basic handoff acceptance, and model processing is a separate
explicitly authorized scenario.

## Native component handoff API

`src/app/mailbox.ts` exports `createMailbox(options?)`, `executeMessageCommand`,
`MessageCaller`, `MessageEnvelope` and views. Options provide env/home/contextRoot
and an explicit clock. Factories perform no writes. `MessageCaller` contains
optional `nativeSessionId` and ordinary `context`; `executeCommand` accepts it as
its sixth argument, and `createServer` as its fourth. The native integration refreshes
actual native caller metadata on session switches; an environment or
user-overridden MCP entry is not proof of a fresh connected caller.

`mailbox.receiver(nativeId)` exposes `list()`, `show(messageId)`,
`claim(messageId)` and selected `cleanup(messageId)`. Claim returns undefined
for an ineligible record, throws on busy/unavailable state, or returns a handle
`{envelope,handoff(currentNativeId,forward)}`. Both callbacks are synchronous:
`currentNativeId()` must read the actual current Pi session ID immediately;
`forward(envelope)` performs the synchronous public Pi call with no await/gap.
The application rechecks expiry and native identity immediately before this
call. It returns false on expiry/mismatch and leaves the claim uncertain.
A thrown call or failed outcome write also leaves uncertainty, not permission
to retry. The handle permits **one attempt only**, even after false/error.
The native layer must not cache a former ID as current authority, call a handoff
for a different session, or mutate the immutable envelope. Successful completion
writes `{version:1,handedAt}`; it never stores a second transcript.
