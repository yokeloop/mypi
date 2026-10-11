import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePiContext, encodePiContext, mcpWorkContext, parsePiContext, PI_CONTEXT_ENTRY, selectPiContext, rootDefaultPiContext } from '../../src/app/pi-context.js';
import { InputError } from '../../src/shared/errors.js';
import { decodeNativeCaller, encodeNativeCaller, nativeCallerEnvironment, sameNativeCaller } from '../../src/app/pi-message-caller.js';

const data = { version: 1 as const, cwd: '/task', context: { scope: { kind: 'project' as const, project: 'one/a' }, worktreeRoot: '/task' } };
const own = (value: unknown) => ({ type: 'custom', customType: PI_CONTEXT_ENTRY, data: value });

test('Pi context selects only the latest entry on the supplied active branch, never older valid state', () => {
  const other = { version: 1, cwd: '/other', context: { scope: { kind: 'project', project: 'two/b' } } };
  for (const [branch, expected] of [
    [[], { state: 'absent' }],
    [[{ type: 'custom', customType: 'another-extension', data }], { state: 'absent' }],
    [[own(data)], { state: 'selected', data }],
    [[own(other), own(data)], { state: 'selected', data }],
    [[own(data), own(other)], { state: 'cwd-mismatch' }],
    [[own(data), own({ ...data, version: 2 })], { state: 'invalid' }],
    [[own(data), own(null)], { state: 'invalid' }],
  ] as const) assert.deepEqual(selectPiContext(branch, '/task'), expected);
  // Reconstructing an empty/foreign branch cannot retain the previously returned project.
  assert.deepEqual(selectPiContext([own(data)], '/changed-cwd'), { state: 'cwd-mismatch' });
  assert.deepEqual(selectPiContext([], '/task'), { state: 'absent' });
});

test('Pi context validates version, known fields and selection/worktree consistency', () => {
  const org = { version: 1, cwd: '/task/sub', context: { scope: { kind: 'organization', organization: 'one' }, selectedProject: 'one/a', worktreeRoot: '/task' } };
  for (const value of [data, org,
    { version: 1, cwd: '/task', context: { scope: { kind: 'organization', organization: 'one' } } },
    { version: 1, cwd: '/task', context: { scope: { kind: 'unrestricted' } } },
  ]) assert.deepEqual(parsePiContext(value), value);
  for (const value of [null, [], {}, { ...data, version: 2 }, { ...data, extra: true },
    { ...data, cwd: 'relative' }, { ...data, cwd: '/task/../other' },
    { ...data, context: { scope: { kind: 'project', project: 'bad' } } },
    { ...data, context: { ...data.context, selectedProject: 'two/b' } },
    { ...org, context: { ...org.context, selectedProject: 'two/b' } },
    { ...data, context: { ...data.context, worktreeRoot: '/task-prefix' } },
    { ...data, context: { scope: { kind: 'unrestricted' }, worktreeRoot: '/task' } },
    { ...data, context: { scope: { kind: 'unrestricted', project: 'one/a' } } },
  ]) assert.equal(parsePiContext(value), undefined, JSON.stringify(value));
  const parsed = parsePiContext(data)!;
  assert.notEqual(parsed.context, data.context);
  assert(Object.isFrozen(parsed) && Object.isFrozen(parsed.context) && Object.isFrozen(parsed.context.scope));
});

test('native root default requires positive fresh configured root and no handoff or saved branch', () => {
  const valid = { state: 'selected' as const, data };
  const absent = { state: 'absent' as const };
  const input = { reason: 'startup', fresh: true, root: true, configured: true, selection: absent };
  assert.equal(rootDefaultPiContext(input), true);
  assert.equal(rootDefaultPiContext({ ...input, reason: 'new' }), true);
  assert.equal(rootDefaultPiContext({ ...input, reason: 'new', handoff: 'old-launch-selection' }), true);
  assert.equal(rootDefaultPiContext({ ...input, reason: 'new', root: false, handoff: 'old-launch-selection' }), false);
  for (const override of [{ handoff: 'valid' }, { handoff: 'invalid' }, { selection: valid },
    { selection: { state: 'invalid' as const } }, { selection: { state: 'cwd-mismatch' as const } },
    { fresh: false }, { root: false }, { configured: false }, { reason: 'resume' },
    { reason: 'fork' }, { reason: 'reload' }, { reason: 'tree' }]) {
    assert.equal(rootDefaultPiContext({ ...input, ...override }), false, JSON.stringify(override));
  }
});

test('native MCP caller is canonical, explicitly cleared and changes with the actual session even in the same context', () => {
  assert.equal(encodeNativeCaller('pi/sender'), 'cGkvc2VuZGVy');
  assert.equal(decodeNativeCaller('cGkvc2VuZGVy'), 'pi/sender');
  assert.equal(decodeNativeCaller(encodeNativeCaller('\ufeff${HOME}/native')), '\ufeff${HOME}/native');
  assert.equal(decodeNativeCaller(undefined), undefined); assert.equal(decodeNativeCaller(''), undefined);
  for (const value of ['=', 'a', '_w', 'YQ=', 'YR', 'AA', 'YQ'.repeat(1000)]) assert.throws(() => decodeNativeCaller(value), InputError);
  for (const value of ['', 'a'.repeat(257), '\u0000', '\ud800']) assert.throws(() => encodeNativeCaller(value), InputError);
  const first = nativeCallerEnvironment({ state: 'selected', data }, 'pi/sender');
  assert.equal(first.MYPI_MCP_NATIVE_SESSION_ID, 'cGkvc2VuZGVy');
  assert.equal(sameNativeCaller(undefined, first), false);
  assert.equal(sameNativeCaller(first, nativeCallerEnvironment({ state: 'selected', data }, 'pi/sender')), true);
  assert.equal(sameNativeCaller(first, nativeCallerEnvironment({ state: 'selected', data }, 'other-session')), false);
  assert.equal(sameNativeCaller(first, nativeCallerEnvironment({ state: 'absent' }, 'pi/sender')), false);
  assert.deepEqual(nativeCallerEnvironment({ state: 'invalid' }, undefined), { MYPI_MCP_CONTEXT: '', MYPI_MCP_NATIVE_SESSION_ID: '' });
});

test('Pi envelope escapes MCP interpolation, rejects malformed input, and distinguishes explicit clear', () => {
  const escaped = { version: 1 as const, cwd: '/tmp/!${HOME}/кириллица', context: { scope: { kind: 'unrestricted' as const } } };
  // Literal independent oracle; transport spelling is shared by the launcher and MCP startup.
  const literal = 'eyJ2ZXJzaW9uIjoxLCJjd2QiOiIveCIsImNvbnRleHQiOnsic2NvcGUiOnsia2luZCI6InVucmVzdHJpY3RlZCJ9fX0';
  const plain = { version: 1 as const, cwd: '/x', context: { scope: { kind: 'unrestricted' as const } } };
  assert.equal(encodePiContext(plain), literal);
  assert.deepEqual(decodePiContext(literal), plain);
  assert.match(encodePiContext(escaped), /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePiContext(encodePiContext(escaped)), escaped);
  for (const bad of ['', '{}', literal + '=', 'a', '_w', 'bnVsbA', 'eyJ2ZXJzaW9uIjoyfQ']) {
    assert.throws(() => decodePiContext(bad), InputError);
  }
  assert.equal(mcpWorkContext(undefined), undefined);
  assert.equal(mcpWorkContext(''), undefined);
  assert.deepEqual(mcpWorkContext(literal), plain.context);
  assert.throws(() => mcpWorkContext('malformed'), InputError);
});
