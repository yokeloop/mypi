# Cooperative policy core (MP-7)

**Working context and configuration diagnostics, not OS isolation.** The MP-7
slice introduced the core below without active guard routing or Pi integration.
Current consumers add [native write/edit guards](PI-WORK-CONTEXT.md#cooperative-native-writeedit-guards),
[application membership/default checks](MCP.md#cooperative-application-membership-and-defaults)
and [four explicit workspace helpers](M1-CLI.md#explicit-git-workspace-helpers).
Operations still use local-user permissions; shell and other clients are not
contained. There is no session registry or policy watcher.

## Working context

The pure `src/modules/work-context/public.ts` API defines `WorkContext`:

- `scope: {kind:"project", project:"example/demo"}` selects one project;
- `scope: {kind:"organization", organization:"example"}` selects an organization;
- `scope: {kind:"unrestricted"}` removes the project filter;
- optional `selectedProject` and `worktreeRoot` describe the concrete working
  selection. An explicit project must agree with project scope. Consumers validate
  project/worktree consistency at their input boundary.

`scopeContainsProject` takes current registry membership for organization checks,
not a saved authority snapshot. There are no profiles, principals, capabilities,
leases or attenuation. Project/organization selection does not require a sandbox.
Data-selection `Scope` remains a separate API and is not an ACL.

`executeCommand`, CLI `run` and MCP `createServer` accept an optional out-of-band
`WorkContext`. This is working selection, not authentication. MP-7 initially left
ordinary operations unchanged; current consumers apply only the documented coverage
and defaults linked above. Existing data/argument validation still applies.
No context wrapper, resolver or fake runtime identity is required.

## Guard policy YAML v2

[Inert example](scoped-policy.example.yaml):

```yaml
version: 2
guards:
  outsideWorktreeWrite: block
  baseCheckoutWrite: block
  foreignMypiTarget: block
```

Only `version` is required. Each omitted guard defaults to `block`; the only
behaviors are `warn` and `block`. These describe the configured response to writing
outside the selected worktree, writing to the base checkout, or targeting a mypi
project outside the working selection. Repository roots come from registry/worktree
selection, not YAML. No per-action allowlists or cascading profiles are supported.

Strict YAML 1.2 parsing uses yaml@2.9.1: at most 65536 UTF-8 bytes, 64 nesting levels
and 4096 AST nodes. Duplicate/non-string keys, anchors, aliases, merge keys, custom
tags and multiple documents fail. The pure work-context API owns semantic checks:
unknown fields, versions and behaviors fail rather than silently becoming defaults.
Version 1 produces an explicit incompatibility error; no personal files are migrated.
Diagnostics omit source excerpts and arbitrary field values.

`validateGuardPolicyText(text)` parses and normalizes a supplied document.
`loadGuardPolicyConfiguration(path)` reads only an operator-selected regular UTF-8
file with the byte limit above. Missing, unreadable or invalid selected files fail;
there is no fallback, implicit home read, write, install or repair. Ordinary relative
paths and symlink aliases are allowed: this is not a UID/ancestor trust hierarchy.
`DEFAULT_GUARD_POLICY` is for absent configuration, not invalid input.

The consumer selector `MYPI_GUARD_POLICY` is distinct from that direct loader API:
it requires an **absolute** file path. Native extension setup and scoped MCP setup
load independently once; direct contextual application/CLI dispatch loads per
covered command unless composition supplies a selected policy/error. Invalid explicit
configuration never becomes defaults. See the [consumer behavior and reload limits](PI-WORK-CONTEXT.md#cooperative-native-writeedit-guards),
including the intentional native/application difference for unselected or unrestricted
calls. Diagnostics do not install or activate this selector.

## Shared diagnostics and transports

Two read-only application commands:

- `policy_validate {text}` returns `{valid:true,policy,diagnostic:"cooperative"}`,
  where `policy` is the normalized version-2 configuration.
- `policy_explain {guard,text?}` returns
  `{guard,behavior,message,diagnostic:"cooperative"}`. Omitted text uses defaults;
  explicitly empty or invalid text fails. Explanation describes a configured
  response, not an intercepted operation or authorization decision.

The old separate preview command is removed; explain accepts optional configuration
without fictional callers, targets or live grants. There are no revisions or snapshots.

```sh
mypi policy validate --file docs/scoped-policy.example.yaml
mypi policy explain outsideWorktreeWrite --file docs/scoped-policy.example.yaml
mypi policy explain baseCheckoutWrite
mypi policy explain foreignMypiTarget 'version: 2'
```

CLI validate requires positional YAML or `--file`; explain accepts either optionally
after the guard. Text and file are mutually exclusive. File input is bounded regular
UTF-8, including when a working context is supplied. MCP accepts `text`, never a host
policy file path. Strict tool schemas reject unknown arguments. Neither transport
installs configuration or changes a running session's settings.

## Repository association helper

`createRepositoryBindings` remains separate from createApp/policy parsing: it takes
an explicit registered project, operator-selected independent primary clone,
candidate existing worktree, optional expected short branch and installed-engine
root. Canonical toplevel/common-dir and exact porcelain-z worktree membership verify
association. Same names/remotes, checkout containment, sibling-prefix paths and
configured root strings do not. Detached/locked/prunable/unusable/foreign/installed
associations fail; a genuinely independent nested clone and its sibling worktrees
may pass. Canonical aliases resolve; dangling aliases fail. Base bindings carry
`baseReadOnly` as guidance for consumers, not a filesystem restriction.

Read-only Git inspection uses sanitized environment/config, fixed local commands,
3-second hard kill and 1 MiB output per invocation, no shell/hooks/filters/network
or mutation. This prevents selecting the wrong checkout; it does not establish
ownership, a runtime write lease or adversarial containment. Repository metadata and
paths can change after inspection. MP-7 supplied only association observations;
current consumers reuse them for the supported guards and explicit workspace helpers
linked above, without a runtime lease or concurrent-writer guarantee.
