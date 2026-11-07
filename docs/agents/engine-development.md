# Developing the mypi engine

Read when: changing mypi source, tests, scripts or shipped integrations, building or verifying it, or carrying out an approved engine feature.

## Repository resources

- Engine resources are tracked in this repository: agent configuration in `.pi/`
  (the Pi extension `.pi/extensions/mypi.ts`; `.pi/skills` points to the built-in
  skills in `integrations/skills/`) and agent texts in `integrations/prompts/`.
  Personal data lives in `home/`; personal agent settings live in each agent's
  user-level configuration (for Pi, `~/.pi/agent/`). Never start tracking `home/`
  or `projects/` in the engine repository, including in future updates.

## Developing the engine

These additional rules govern mypi source, tests, scripts and shipped integrations
in project task worktrees. They do not impose mypi's stack or test runner on other
projects. Inspect each project's own instructions and verification commands.

- TypeScript strict, Node.js 24 LTS, ESM/tsc, pnpm, SQLite + better-sqlite3,
  SQL migrations without an ORM, node:test + node:assert/strict.
- The web UI (`web/`, a pnpm workspace package) uses React, Mantine and Vite in
  Feature-Sliced Design layers, enforced by `.dependency-cruiser.web.cjs`.
  `pnpm build` typechecks it and bundles it into `dist/ui`; its pure logic in
  `web/src/shared/lib/` is tested with node:test, the UI itself on the stand.
- The terminal UI (`tui/`, Rust + ratatui, docs/TUI.md) reads data only through
  the HTTP API and opens tabs only through `mypi open`. Rust is pinned in
  `mise.toml` and `tui/rust-toolchain.toml` (change both together); run
  `pnpm tui:fetch` once per checkout (network), and `pnpm verify` runs its cargo
  checks offline in the bounded `mypi-tui-check` unit. Linking the Herdr plugin
  and binding its key are user configuration, done only on the user's request.
- Modular monolith, domain modules with Ports & Adapters and use cases.
  Before structural/dependency changes, inspect current module boundaries and
  contracts; preserve the separation of domain, application and adapters.
- CLI and MCP share typed application commands. Keep adapters thin; fix every
  affected entry point. No domain logic in scripts or private cross-module imports.
- Before changing tests or their execution, inspect existing tests and their
  runner. Protect observable behavior at the cheapest reliable level; do not add
  redundant tests, new runners or higher resource limits just to get green. Use
  only disposable data under the approved isolation (2 CPU, 1 GiB, 64 tasks,
  60-second external deadline, one suite run at a time; no network or personal
  home); if unavailable, stop rather than using an unsafe fallback. Fast tests
  must not spawn subprocesses; boundary tests may use isolated CLI/Git processes.
  Do not weaken admission or mandatory checks. CI tests the proposed revision
  with its own locked dependencies and scripts; changes to package.json, lockfiles
  or build scripts do not require promoting a separate trusted base.
- Testing policy: [docs/TESTING.md](../TESTING.md).
- For explicitly requested live acceptance in a disposable test installation, use
  the [Herdr manual acceptance guide](../MANUAL-ACCEPTANCE.md). It supplements
  mandatory verification; it does not authorize storage resets or session control.
- Build changed code: `mise exec -- pnpm build`.
  Verify completion: `mise exec -- pnpm verify`; `pnpm test` alone is insufficient.
- Do not restore removed prototype/import compatibility or implement speculative
  flows, agents, recovery infrastructure or runtime enforcement without a request.
- Do not modify global Pi settings as incidental repository upkeep. Explicitly
  requested installation/removal is a separate, narrowly scoped operation.

## Engine feature-development workflow

For an approved mypi engine feature plan, use native subagents for implementation,
independent test-diff review and verification. Assemble a tested task branch, push
and open a PR with evidence; do not merge or update the primary installation by
inference. When live acceptance applies, use a designated disposable test
installation: archive existing test data before a clean refresh, write an executable
checklist, exercise the real Pi UI through Herdr, verify state independently, and
fix and retest in-scope failures without requesting repeated permission. See
[the manual acceptance guide](../MANUAL-ACCEPTANCE.md) for stand boundaries.
This standing authorization is for approved engine features, not managed project
checkouts, backlog execution, arbitrary resets, other sessions or a flow runner.

## Candidate checkouts and Pi trust

- Pi applies the closest saved trust decision of a folder or its parents, so a
  mypi development clone or task worktree under this installation's `projects/`
  inherits the installation's trust and loads the candidate's `.pi/extensions`,
  whose MCP server and warmup use the default database. Start Pi in such a
  checkout only with `XDG_STATE_HOME` set to disposable test state, or with
  `pi -ne`; never against the personal DB.
