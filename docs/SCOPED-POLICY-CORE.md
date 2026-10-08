# Scoped policy core (MP-7)

**Diagnostics and trusted composition contracts, not active enforcement.** No
launcher, broker, HomeWriter, session persistence, policy watcher, Pi integration
or workspace mutation is installed by this slice. MP-8/9 must authenticate callers,
construct trusted contexts and enforce resources at actual effect boundaries.
Legacy CLI/MCP calls with no context remain **unprotected**, using local-user
permissions. Existing data-selection `Scope` is not an authorization scope or ACL.

## Policy YAML v1

[Inert example](scoped-policy.example.yaml). Only these fields are implemented:

```yaml
version: 1
defaults: {allow: [data.read, filesystem.read, workspace.inspect, policy.validate, policy.explain]}
profiles:
  standard: {isolation: none}        # optional allow
  isolated: {isolation: required}    # optional allow
overrides:
  organizations:
    example: {allow: [data.read]}
  projects:
    example/demo: {allow: [data.read]}
repositories:
  example/demo: {root: /srv/mypi-projects/example/demo}
```

Only `version` is required. The shown defaults are the read-only default allow
list. A present defaults/override entry requires `allow`; profiles may omit it.
Organization/project identities use lowercase alphanumeric slug segments, optionally
separated by `.`, `_` or `-`; a project is exactly `organization/project`.
Repository roots must be absolute paths, but **strings do not verify repositories**.

Actions: `data.read`, `data.write`, `filesystem.read`, `filesystem.write`,
`execution.run`, `workspace.inspect`, `workspace.prepare`, `workspace.commit`,
`workspace.publish`, `workspace.remove`, `runtime.control`, `administration`,
`policy.validate`, `policy.explain`.

Permissions intersect defaults → selected profile → resolved resource organization
→ resolved resource project. Omitted narrower allow inherits; `[]` denies all.
An override cannot add rights; a project override does not restrict another project
in the same organization. Isolation/admin/ownership ceilings cannot be configured away.

Strict YAML 1.2 parsing uses yaml@2.9.1: at most 65536 UTF-8 bytes, 64 nesting levels,
4096 AST nodes. Duplicate keys/actions, non-string keys, anchors, aliases, merge
keys, custom tags, multiple documents, unknown fields/versions/types/actions and
incompatible isolation settings fail. Diagnostics omit source excerpts and arbitrary
field values. Syntax parsing delegates semantic validation to the authorization API.

## Snapshots, callers and decisions

Authorization scope is separate from data-selection scope:

- `{"kind":"project","project":"example/demo"}`;
- `{"kind":"organization","organization":"example","projects":["example/demo"]}`
  with explicit frozen membership, not a future wildcard;
- `{"kind":"unrestricted"}` removes project filtering, not admin/ownership checks.

Project/organization requires `isolated`; the default profile is `standard`, so
scoped snapshot/preview creation must explicitly select `isolated`. This profile
requirement is a policy rule, not proof that a process has been isolated.

Snapshots copy/freeze nested inputs. Effective decisions require matching trusted
principal/session/runtime identity and profile, scope, rule permission, and required
capabilities/ownership. Scoped global/all/foreign data is denied. Specifically resolved
inherited parent memory is distinct from blanket parent-data access. Base clones are
read-only; worktree writes need owned binding references; managed-home data writes
need the future `HomeWriter`. Unrestricted is not administration. Protected policy
filesystem/control-plane/shared-Git access is not an ordinary data/workspace grant.

`workspace.prepare` takes a verified **SOURCE** binding and explicit prepare
capability plus session/runtime identity. It describes preparing a NEW workspace;
it grants no writes to the source/base or ownership of an existing target.

`validatePolicyText` returns a configuration-only SHA-256 revision.
`createRevisionedPolicySnapshot` hashes normalized policy, identity, scope/membership,
profile, effective permissions and verified binding identities, excluding timestamps.
Equivalent normalized inputs have stable revisions. Configuration and effective
snapshot revisions are different concepts; neither is a credential. Decisions report
only the evaluated revision and generic reason/rule, not paths, identities or grants.

The pure resume API intersects saved/current rights and membership; no expansion.
Missing/changed identity or binding, or incompatible scope, requires reconciliation,
never unrestricted fallback. Ownership is not restored and must be reacquired. The
caller supplies the resulting revision; no runtime resume/storage flow is implemented.

## Diagnostics and transports

Three shared application commands, all read-only diagnostics:

- `policy_validate {text}` → `{valid:true,revision,revisionKind:"configuration",enforced:false}`.
  Invalid YAML returns an error, never installs policy.
- `policy_explain {action,target}` → `{allowed,revision,reason,rule,preview:false,enforced:false}`.
  Uses only the supplied trusted effective snapshot; never reloads a policy file.
  Missing context denies with `context-unavailable` and `revision:null`.
- `policy_preview {text,action,target,scope,profile?}` → the same decision shape with
  `preview:true`. The caller is fixed non-admin service `policy-preview`, with no
  session/runtime, capabilities, repository bindings or owned worktrees. This is a
  hypothetical evaluation, **not a live grant**, even when `allowed:true`.

Targets are strict **untrusted selectors**:

```json
{"kind":"project","project":"example/demo"}
{"kind":"organization","organization":"example"}
{"kind":"request","key":"DEMO-1"}
{"kind":"repository","bindingId":"trusted-binding-reference"}
```

Kind-only selectors: `global`, `all`, `policy`, `scratch`, `runtime`, `shared-git`,
`control-plane`, `administrative`. Selector strings are nonempty, at most 1024
characters and cannot contain NUL. Preview organization membership has at most 1024
entries. No target accepts resolved parents/owners/commonDir, filesystem paths,
principal/session, capabilities, ownership or an effective snapshot.

`TrustedExecutionContext` is injected out-of-band into `executeCommand`, CLI `run`
or MCP `createServer`, never from command fields. Its data resolver must use trusted
registry/request ownership lookup, returning resolved data (or specifically inherited
memory), not echoing claimed parent fields. Repository selectors reference existing
snapshot bindings; scratch/runtime select only the caller's own identity. Missing,
foreign or failed resolution returns the same generic `target-unavailable` result,
without forwarding resolver errors. Preview treats project/org/global/all selectors
as hypothetical data, but cannot resolve requests or verify repository bindings.

Any context-bearing **non-diagnostic** dispatch fails explicitly unavailable until
MP-9, before opening storage/performing legacy effects. CLI rejects before translation
can read legacy host-file inputs. Context-bearing CLI validate/preview also rejects
`--file` until MP-9 can route filesystem inputs through resource authorization;
such callers must supply YAML text instead. No-context legacy behavior is preserved, not claimed
protected. TypeScript context types are not authentication; only trusted composition
may supply the resolver, snapshot, capabilities and ownership.

CLI examples (target/scope arguments are JSON):

```sh
mypi policy validate --file docs/scoped-policy.example.yaml
mypi policy preview data.read --file docs/scoped-policy.example.yaml \
  --scope '{"kind":"project","project":"example/demo"}' --profile isolated \
  --target '{"kind":"project","project":"example/demo"}'
mypi policy explain data.read --target '{"kind":"project","project":"example/demo"}'
```

The ordinary CLI/stdio entrypoints supply no live context: the last example denies.
CLI validate/preview also accept YAML text positionally (`preview` after action).
Without trusted context, `--file` reads bounded regular UTF-8 input (65536 bytes), not trusted live authority;
it neither installs nor activates policy. MCP accepts YAML `text`, **not host policy
file paths**. Its strict nested schemas reject caller/evidence spoofing. Existing
legacy tools' host-file arguments remain unprotected and are not made safe by this API.

`src/app/command-effects.ts` is a compile-time exhaustive inventory for every
`AppCommand`: scoped-data, workspace, runtime-control (no current commands), and
administrative categories. It records broad listings/history, indirect request
ownership, host-file inputs and compound home writes/Git commits. **It is not an
authorization-by-command-name table.** MP-9 must resolve all resources and filter
results before disclosure, including compound and indirect effects.

## Trusted source and repository limitations

`loadPolicyConfiguration` separately loads an explicitly trusted absolute path or
operator home `pi/mypi-policy.yaml`. Missing/invalid/unsafe sources fail; no fallback.
The effective-UID-owned regular file must have one hardlink and no group/other writes.
Ancestors must be non-symlink directories owned by root/effective UID without
untrusted writes (root-owned sticky `/tmp` and `/var/tmp` are the narrow exception).
Bounded nofollow/nonblock reads and metadata rechecks detect some races, not all.
Same-UID processes and stable ancestor/mount namespaces remain trusted assumptions.
These loader restrictions are not authority inferred from a CLI `--file` argument.

`createRepositoryBindings` is separate from createApp/policy parsing: explicit
registered project, operator-selected independent primary clone, candidate existing
worktree, optional expected short branch and trusted installed-engine root. Canonical
toplevel/common-dir and exact porcelain-z worktree membership prove association.
Same names/remotes, checkout containment, sibling-prefix paths and configured root
strings do not. Detached/locked/prunable/unusable/foreign/installed associations fail;
a genuinely independent nested clone and its sibling worktrees may pass. Canonical
aliases resolve; dangling aliases fail. Base is read-only.

Read-only Git evidence uses sanitized environment/config, fixed local commands,
3-second hard kill and 1MiB output per invocation, no shell/hooks/filters/network or
mutation. Git binary and repository metadata are trusted. This observation is **not
ownership, a sandbox or a runtime write lease**. Revalidate at future effects;
same-UID changes, TOCTOU, hardlinks, bind mounts and changing mount namespaces are not
solved by canonical paths. Real OS/process/provider/control-plane protection remains
MP-8/9 work; MP-7 does not connect candidate policy to personal runtime data.
