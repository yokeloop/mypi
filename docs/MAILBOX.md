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

The native component's intended public call is `pi.sendMessage` with
`deliverAs:'nextTurn', triggerTurn:false`, clearly labeled as another session's
message. Pi 1.0.4 queues nextTurn messages **in memory** until a later user turn;
quit or switching sessions may lose pending text even after a handoff receipt.
There is no automatic resend, model turn or exactly-once processing promise.
This mailbox component alone does not install a timer or receiver extension.

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

## Native component handoff API

`src/app/mailbox.ts` exports `createMailbox(options?)`, `executeMessageCommand`,
`MessageCaller`, `MessageEnvelope` and views. Options provide env/home/contextRoot
and an explicit clock. Factories perform no writes. `MessageCaller` contains
optional `nativeSessionId` and ordinary `context`; `executeCommand` accepts it as
its sixth argument, and `createServer` as its fourth. The native integration owns
refreshing actual native caller metadata on session switches; an environment or
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
