<!-- mypi MCP begin -->
## mypi memory and task context

- On a new/resumed host conversation, call `mcp__mypi__project_resolve` with the session's working directory, then `warmup` with its returned scope. For none/ambiguous, select an existing project explicitly; never auto-register it.
- Discover other tools through `searchTools`/`describeNamespace("mcp__mypi")` and call them from codemode. Inspect `isError` and `structuredContent.status`: MCP errors can resolve as results rather than throw.
- Always provide explicit scope. Global does not mean the entire journal. Warmup is an index: read full journal/context records for historical questions, with a bounded history limit.
- Requests are optional. To continue one, read its current card, history and artifacts. Read status codes from the DB; never reopen a terminal request.
- Record real outcomes in the same session: project `journal_add` or task `request_progress`, without duplicating one outcome. Preserve source exactly.
- Partial, timeout or disconnection does not mean rollback. Reconcile DB/files/journal/Git before repeating create/append or explicitly finishing missing effects. Memory numbers are current positions; reread `memory_show` before removing one.
- `db_init`/bootstrap/restore require explicit engineer intent; stop other writers before bootstrap/restore or a schema upgrade. A missing DB is not permission for personal initialization. No automatic network/push.
- The full MCP server is a trusted-host endpoint, not an ACL for workers. `run_*` manages only explicitly authorized launches with budgets; creating a card never launches one. Scoped workers use their separate bound listener and `/context/task.json`, not this full control endpoint. Tool availability, client IDs and annotations are not permission to broaden resources.
- Process exit/export does not accept a request. No automatic final journal is written when a session closes. Follow the selected unit/flow acceptance and delivery gates.
<!-- mypi MCP end -->
