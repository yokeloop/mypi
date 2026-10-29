---
name: open
description: Open or focus mypi sessions in Herdr tabs — "/open <key...> [--agent claude|pi] [--permission-mode mode]". Keys are a project code (MP), CODE-N (MP-12), org/project or org/project#N.
---

The user asked to open sessions. Call the mypi tool `open_session` once with
`keys` set to the keys from the arguments, `agent` from `--agent` and
`permissionMode` from `--permission-mode` when given. Do not open anything else,
do not retry and do not start work in the opened sessions.

Report each entry of `opened`: key, agent, focused/resumed/started and its notes.
On an error or a partial result, report the message and, for partial, which
keys were opened and which were not.
