---
name: open
description: Open or focus mypi sessions in Herdr tabs — "/open <key...> [--agent claude|pi] [--permission-mode mode] [--message text]". Keys are a project code (MP), CODE-N (MP-12), org/project or org/project#N.
---

The user asked to open sessions. Call the mypi tool `open_session` once with
`keys` set to the keys from the arguments, `agent` from `--agent`,
`permissionMode` from `--permission-mode` and `message` from `--message` (the
whole rest of the line after it) when given. Do not open anything else, do not
retry and do not start work in the opened sessions — except that a message given
with --message is delivered as the parent's instruction.

Report each entry of `opened`: key, agent, focused/resumed/started, its `message`
id and its notes, including a note that the start message was not delivered or
that a message stays queued.
On an error or a partial result, report the message and, for partial, which
keys were opened and which were not.

A project without a clone is first cloned from its registered `repository`
(`local`: `git init`); its entries carry the note `clone prepared: …`. On the
refusal "no repository to clone it from", pass the text to the user. If the user
then names a Git remote URL or `local`, set it with `projects` action `update`
(`expectedRepository` null) and call `open_session` once more.
