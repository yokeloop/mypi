---
name: open
description: Open or focus mypi sessions in Herdr tabs — "/open <key...> [--agent claude|pi] [--new | --session <native-id>] [--permission-mode mode] [--message text]". Keys are an organization slug (tb-ff), a project code (MP), CODE-N (MP-12), org/project or org/project#N.
---

The user asked to open sessions. Call the mypi tool `open_session` once with
`keys` set to the keys from the arguments, `agent` from `--agent`, `new: true`
from `--new`, `session` from `--session`, `permissionMode` from
`--permission-mode` and `message` from `--message` (the whole rest of the line
after it) when given. Do not open anything else, do not retry and do not start
work in the opened sessions — except that a message given with --message is
delivered as the parent's instruction.

Run these steps every time, also when this session is already in the requested
scope: /open from a key's own session is a normal use — it may focus another
session of the key, start a new one (another agent or `--new`) or resume one.
Never answer from your own context or decide that nothing needs opening; the
result comes only from the tools. Call `sessions` first when the rule below
applies, then `open_session` exactly once.

When there is one key and neither `--new` nor `--session` is given, first call
`sessions` and find the node whose `key` equals the key (an organization, `CODE`
or `CODE-N`; for the forms `org/project` and `org/project#N` no list is built).
If that node has two sessions or more, show a table (agent, device, `activeAt`,
`live|closed`) and ask the user "new or return": the options "As usual" (no
flags), "New session" (the agent from `--agent`, else the default) and "Return:
<agent> · <device> · <activeAt>" for each session; then call `open_session` once
— without flags, with `new: true` or with `session: <nativeId>`. A session of
another device is refused: pass the error text to the user. With one session or
none, call `open_session` at once. The rule "one call, no retries" stays.

Report each entry of `opened`: key, agent, focused/resumed/started, its `message`
id and its notes, including a note that the start message was not delivered or
that a message stays queued.
On an error or a partial result, report the message and, for partial, which
keys were opened and which were not.

A project without a clone is first cloned from its registered `repository`
(`local`: `git init`); its entries carry the note `clone prepared: …`. On the
refusal "no repository to clone it from", pass the text to the user. If the user
then names the Git remote URL, set it with `projects` action `update`
(`expectedRepository` null) and call `open_session` once more.

A large clone reports its progress while it runs. If the user interrupts it, the
result is an error "open cancelled while cloning …; nothing was registered":
report it; the next /open prepares the clone again.
