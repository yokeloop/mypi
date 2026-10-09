import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GUARD_POLICY, normalizeGuardPolicy, explainGuard, scopeContainsProject } from '../../src/modules/work-context/public.js';
import type { GuardName, WorkContext, WorkScope } from '../../src/modules/work-context/public.js';
import { InputError } from '../../src/shared/errors.js';

test('work-context selection uses current organization observations without runtime prerequisites', () => {
  const context: WorkContext = { scope: { kind: 'project', project: 'one/a' }, worktreeRoot: '/task' };
  const cases: readonly [WorkScope, string, readonly string[], boolean][] = [
    [context.scope, 'one/a', [], true],
    [context.scope, 'one/b', ['one/b'], false],
    [{ kind: 'organization', organization: 'one' }, 'one/b', ['one/a', 'one/b'], true],
    [{ kind: 'organization', organization: 'one' }, 'one/new', ['one/a'], false],
    [{ kind: 'organization', organization: 'one' }, 'one/new', ['one/a', 'one/new'], true],
    [{ kind: 'organization', organization: 'one' }, 'one/a', [], false],
    [{ kind: 'unrestricted' }, 'two/other', [], true],
  ];
  for (const [scope, project, members, expected] of cases) {
    assert.equal(scopeContainsProject(scope, project, members), expected, `${scope.kind}: ${project} in ${members.join(',')}`);
  }
});

test('work-context guard policy defaults, explicit responses and schema diagnostics', () => {
  const defaults = { version: 2, guards: {
    outsideWorktreeWrite: 'block', baseCheckoutWrite: 'block', foreignMypiTarget: 'block',
  } };
  assert.deepEqual(DEFAULT_GUARD_POLICY, defaults);
  assert.deepEqual(normalizeGuardPolicy({ version: 2 }), defaults);
  assert.deepEqual(normalizeGuardPolicy({ version: 2, guards: {} }), defaults);
  const descriptions: readonly [GuardName, string][] = [
    ['outsideWorktreeWrite', 'writing outside the selected worktree'],
    ['baseCheckoutWrite', 'writing to the base checkout'],
    ['foreignMypiTarget', 'targeting a mypi project outside the working selection'],
  ];
  for (const [guard, description] of descriptions) {
    const policy = normalizeGuardPolicy({ version: 2, guards: { [guard]: 'warn' } });
    assert.deepEqual(policy, { ...defaults, guards: { ...defaults.guards, [guard]: 'warn' } });
    assert.deepEqual(explainGuard(policy, guard), {
      guard, behavior: 'warn', message: `Configured to warn when ${description}.`,
    });
    assert.deepEqual(explainGuard(normalizeGuardPolicy(defaults), guard), {
      guard, behavior: 'block', message: `Configured to block when ${description}.`,
    });
  }
  const invalid: readonly [unknown, RegExp][] = [
    [null, /document: expected mapping/],
    [undefined, /document: expected mapping/],
    [[], /document: expected mapping/],
    [{}, /version: expected 2/],
    [{ version: 1, profiles: { isolated: {} } }, /version 1 is incompatible; use version 2/],
    [{ version: 3 }, /version: expected 2/],
    [{ version: '2' }, /version: expected 2/],
    [{ version: 2, profiles: {} }, /document: unknown field/],
    [{ version: 2, guards: null }, /guards: expected mapping/],
    [{ version: 2, guards: [] }, /guards: expected mapping/],
    [{ version: 2, guards: { outsideWorktreeWrites: 'warn' } }, /guards: unknown field/],
    [{ version: 2, guards: { outsideWorktreeWrite: 'allow' } }, /guards.outsideWorktreeWrite: expected warn or block/],
    [{ version: 2, guards: { baseCheckoutWrite: null } }, /guards.baseCheckoutWrite: expected warn or block/],
    [{ version: 2, guards: { foreignMypiTarget: true } }, /guards.foreignMypiTarget: expected warn or block/],
  ];
  for (const [value, message] of invalid) {
    assert.throws(() => normalizeGuardPolicy(value), error => error instanceof InputError && message.test(error.message));
  }
});
