import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, normalizePolicy, createPolicySnapshot, decideAuthorization, attenuatePolicySnapshot } from '../../src/modules/authorization/public.js';
import type { Action, AuthorizationResource, AuthorizationScope, PolicySnapshot, TrustedCallerContext } from '../../src/modules/authorization/public.js';

// One in-process public-API table protects the new policy seam, without simulating sessions or effects.
test('authorization intersects scope, rules and trusted prerequisites; snapshots and resume cannot expand rights', () => {
  const identity = { principal: { kind: 'agent' as const, id: 'worker' }, sessionId: 'session', runtimeId: 'runtime' };
  const bindings = [
    { id: 'base', project: 'one/a', baseRoot: '/repo', commonDir: '/repo/.git', worktreeRoot: '/repo', branch: 'main' },
    { id: 'owned', project: 'one/a', baseRoot: '/repo', commonDir: '/repo/.git', worktreeRoot: '/task', branch: 'task' },
    { id: 'unowned', project: 'one/a', baseRoot: '/repo', commonDir: '/repo/.git', worktreeRoot: '/other', branch: 'other' },
  ];
  const all = normalizePolicy({ version: 1, defaults: { allow: [...ACTIONS] } });
  const scope: AuthorizationScope = { kind: 'project', project: 'one/a' };
  const snapshot = createPolicySnapshot({ revision: 'initial', identity, scope, profile: 'isolated', policy: all, bindings });
  const caller = (snapshot: PolicySnapshot): TrustedCallerContext => ({ ...snapshot.identity, profile: snapshot.profile,
    snapshot, capabilities: [], ownedBindingIds: ['owned'] });
  const own: AuthorizationResource = { kind: 'data', record: 'request', owner: { kind: 'project', project: 'one/a' } };
  const cases: readonly [string, Action, AuthorizationResource, string][] = [
    ['own-project control', 'data.read', own, 'allowed'],
    ['foreign project', 'data.read', { ...own, owner: { kind: 'project', project: 'two/secret' } }, 'scope-denied'],
    ['global data', 'data.read', { ...own, owner: { kind: 'global' } }, 'scope-denied'],
    ['all data', 'data.read', { ...own, owner: { kind: 'all' } }, 'scope-denied'],
    ['inherited memory only', 'data.read', { kind: 'inherited-memory', owner: { kind: 'global' }, consumerProject: 'one/a' }, 'allowed'],
    ['foreign inheritance', 'data.read', { kind: 'inherited-memory', owner: { kind: 'global' }, consumerProject: 'two/secret' }, 'scope-denied'],
    ['policy write', 'filesystem.write', { kind: 'policy' }, 'protected-resource'],
    ['shared git', 'filesystem.read', { kind: 'shared-git' }, 'protected-resource'],
    ['control plane', 'filesystem.read', { kind: 'control-plane' }, 'protected-resource'],
    ['base write', 'filesystem.write', { kind: 'repository', bindingId: 'base' }, 'base-read-only'],
    ['prepare requires capability', 'workspace.prepare', { kind: 'repository', bindingId: 'base' }, 'capability-required'],
    ['unowned write', 'workspace.commit', { kind: 'repository', bindingId: 'unowned' }, 'ownership-required'],
    ['owned write', 'workspace.commit', { kind: 'repository', bindingId: 'owned' }, 'allowed'],
    ['unknown binding', 'filesystem.read', { kind: 'repository', bindingId: 'missing' }, 'binding-required'],
    ['managed home write', 'data.write', own, 'capability-required'],
    ['invalid effect', 'administration', own, 'invalid-input'],
    ['own scratch', 'execution.run', { kind: 'scratch', sessionId: 'session' }, 'allowed'],
    ['foreign scratch', 'filesystem.read', { kind: 'scratch', sessionId: 'other' }, 'ownership-required'],
    ['runtime capability', 'runtime.control', { kind: 'runtime', runtimeId: 'runtime' }, 'capability-required'],
  ];
  for (const [label, action, resource, reason] of cases) {
    assert.deepEqual(decideAuthorization(caller(snapshot), action, resource), {
      allowed: reason === 'allowed', revision: 'initial', reason, rule: reason,
    }, label);
  }
  assert.equal(decideAuthorization({ ...caller(snapshot), capabilities: ['HomeWriter'] }, 'data.write', own).allowed, true);
  const preparer: TrustedCallerContext = { ...caller(snapshot), capabilities: ['workspace.prepare'], ownedBindingIds: [] };
  assert.equal(decideAuthorization(preparer, 'workspace.prepare', { kind: 'repository', bindingId: 'base' }).allowed, true);
  assert.equal(decideAuthorization(preparer, 'execution.run', { kind: 'repository', bindingId: 'base' }).reason, 'base-read-only');
  assert.equal(decideAuthorization(caller(snapshot), 'unknown' as Action, own).reason, 'invalid-input');
  assert.equal(decideAuthorization(caller(snapshot), 'data.read', { kind: 'unknown' } as unknown as AuthorizationResource).reason, 'invalid-input');
  assert.equal(decideAuthorization({ ...caller(snapshot), sessionId: 'other' }, 'data.read', own).reason, 'identity-mismatch');
  assert.throws(() => createPolicySnapshot({ revision: 'bad', identity, scope, profile: 'standard', policy: all, bindings }), /isolated/);
  const unrestricted = createPolicySnapshot({ revision: 'unrestricted', identity, scope: { kind: 'unrestricted' }, policy: all, bindings });
  assert.equal(unrestricted.profile, 'standard');
  assert.equal(decideAuthorization(caller(unrestricted), 'administration', { kind: 'administrative' }).reason, 'capability-required');
  assert.equal(decideAuthorization(caller(unrestricted), 'filesystem.write', { kind: 'repository', bindingId: 'unowned' }).reason, 'ownership-required');

  const members = ['one/b', 'one/a'];
  const restricted = normalizePolicy({ version: 1, defaults: { allow: [...ACTIONS] },
    profiles: { isolated: { allow: ['data.read', 'data.write'] } },
    overrides: { organizations: { one: { allow: ['data.read'] } }, projects: { 'one/a': { allow: [] } } } });
  const org = createPolicySnapshot({ revision: 'org', identity, scope: { kind: 'organization', organization: 'one', projects: members },
    profile: 'isolated', policy: restricted, bindings });
  assert.equal(decideAuthorization(caller(org), 'data.read', own).reason, 'rule-denied');
  const sibling: AuthorizationResource = { ...own, owner: { kind: 'project', project: 'one/b' } };
  assert.equal(decideAuthorization(caller(org), 'data.read', sibling).allowed, true, 'project override cannot restrict unrelated members');
  assert.equal(decideAuthorization({ ...caller(org), capabilities: ['HomeWriter'] }, 'data.write', sibling).reason, 'rule-denied');
  members.push('one/new'); bindings[1]!.worktreeRoot = '/changed'; identity.principal.id = 'changed';
  assert.equal(decideAuthorization(caller(org), 'data.read', { ...own, owner: { kind: 'project', project: 'one/new' } }).reason, 'scope-denied');
  assert.equal(snapshot.bindings[1]!.worktreeRoot, '/task');
  assert.equal(snapshot.identity.principal.id, 'worker');
  assert.throws(() => (org.scope as unknown as { projects: string[] }).projects.push('one/new'), TypeError);
  assert.throws(() => (org.permissions.projects['one/a'] as Action[]).push('data.read'), TypeError);

  const current = createPolicySnapshot({ revision: 'current', identity: snapshot.identity,
    scope: { kind: 'organization', organization: 'one', projects: ['one/b', 'one/new'] }, profile: 'isolated', policy: all, bindings: snapshot.bindings });
  const resumed = attenuatePolicySnapshot(org, current, 'resume');
  assert.equal(resumed.status, 'resumed');
  if (resumed.status !== 'resumed') throw new Error('Expected resumed snapshot');
  assert.deepEqual(resumed.snapshot.scope, { kind: 'organization', organization: 'one', projects: ['one/b'] });
  assert.deepEqual(resumed.ownedBindingIds, []);
  assert.equal(decideAuthorization(caller(resumed.snapshot), 'data.read', sibling).allowed, true);
  assert.equal(decideAuthorization({ ...caller(resumed.snapshot), capabilities: ['HomeWriter'] }, 'data.write', sibling).reason, 'rule-denied');
  const tightened = attenuatePolicySnapshot(current, org, 'tightened');
  assert.equal(tightened.status, 'resumed');
  if (tightened.status === 'resumed') assert.equal(decideAuthorization(caller(tightened.snapshot), 'data.write', sibling).reason, 'rule-denied');
  assert.deepEqual(attenuatePolicySnapshot(snapshot, { ...snapshot, identity }, 'changed'), { status: 'reconciliation-required', reason: 'identity-changed' });
  assert.deepEqual(attenuatePolicySnapshot(snapshot, { ...snapshot, identity: undefined } as unknown as PolicySnapshot, 'missing'), { status: 'reconciliation-required', reason: 'identity-changed' });
  assert.deepEqual(attenuatePolicySnapshot(snapshot, { ...snapshot, bindings: [] }, 'missing'), { status: 'reconciliation-required', reason: 'binding-changed' });
  assert.deepEqual(attenuatePolicySnapshot(snapshot, { ...snapshot, bindings }, 'changed'), { status: 'reconciliation-required', reason: 'binding-changed' });

  assert.equal(normalizePolicy({ version: 1 }).defaults.allow.includes('data.write'), false);
  assert.deepEqual(normalizePolicy({ version: 1, defaults: { allow: [] }, profiles: { isolated: { allow: ['data.write'] } } }).profiles.isolated.allow, []);
  assert.equal(normalizePolicy({ version: 1, repositories: { 'one/a': { root: '/configured-only' } } }).repositories['one/a']!.root, '/configured-only');
  for (const invalid of [
    { version: 2 }, { version: 1, unexpected: true }, { version: 1, defaults: {} },
    { version: 1, defaults: { allow: ['unknown'] } }, { version: 1, defaults: { allow: ['data.read', 'data.read'] } },
    { version: 1, profiles: { isolated: { isolation: 'none' } } }, { version: 1, profiles: { standard: { allow: null } } },
    { version: 1, overrides: { projects: { 'not-project': { allow: [] } } } },
    { version: 1, repositories: { 'one/a': { root: 'relative' } } },
    { version: 1, repositories: { 'one/a': { root: '/repo', verified: true } } },
  ]) assert.throws(() => normalizePolicy(invalid), /Invalid policy/);
});
