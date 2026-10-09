import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionCards, parseSessionCard, resolveSessionDirectory } from '../../src/app/session-cards.js';
import { sessionView, startSessionCard, updateSessionCard } from '../../src/modules/session-cards/public.js';
import { sessionCardFiles } from '../../src/infrastructure/filesystem/session-cards.js';
import { sessionResults } from '../../src/mcp/tools/sessions.js';

const key = '11111111-1111-4111-8111-111111111111';
const observation = { nativeSessionId: 'pi-owned-id', cwd: '/task',
  context: { scope: { kind: 'project' as const, project: 'one/project' }, worktreeRoot: '/task' }, pid: 123 };

test('session-cards clock table preserves observed transitions, exact age boundary and closed precedence', () => {
  let card = startSessionCard(key, observation, 1000);
  assert.equal(sessionView(card, false, 1000).status, 'starting');
  for (const [event, at, expected] of [
    ['running', 1100, 'running'], ['heartbeat', 1200, 'running'],
    ['settled', 1300, 'idle'], ['heartbeat', 1400, 'idle'], ['close', 1500, 'closed'],
    ['running', 1600, 'closed'], ['settled', 1700, 'closed'],
  ] as const) {
    card = updateSessionCard(card, event, at);
    assert.equal(card.state, expected);
    assert.equal(card.lastSeen, Math.min(at, 1500));
    assert.equal(card.instanceKey, key);
    assert.equal(card.startedAt, 1000);
  }
  const idle = { ...card, state: 'idle' as const, lastSeen: 1000 };
  for (const [now, threshold, expected, age] of [
    [1000, 90000, 'idle', 0], [91000, 90000, 'idle', 90000], [91001, 90000, 'stale', 90001],
    [1002, 1, 'stale', 2], [999, 90000, 'unknown', null], [NaN, 90000, 'unknown', null],
    [Infinity, 90000, 'unknown', null], [1000.5, 90000, 'unknown', null],
  ] as const) {
    const view = sessionView(idle, true, now, threshold);
    assert.deepEqual({ status: view.status, ageMs: view.ageMs, archived: view.archived }, { status: expected, ageMs: age, archived: true });
  }
  assert.equal(sessionView(card, false, 1_000_000).status, 'closed');
  assert.equal(sessionView(card, false, 1499).status, 'unknown');
  assert.throws(() => sessionView(card, false, 2000, -1));
  assert.throws(() => startSessionCard(key, observation, NaN));
  const plain = startSessionCard(key, observation, 1000);
  assert.deepEqual(parseSessionCard(plain, key), plain);
  for (const change of [{ version: 2 }, { instanceKey: 'another' }, { nativeSessionId: '' }, { cwd: 'relative' },
    { state: ['running'] }, { state: 'dead' }, { lastSeen: -1 }, { startedAt: 1.5 }, { pid: 0 },
    { nativeSessionFile: '../history' }, { title: null }, { herdrTabId: '' }, { extra: true },
    { context: { scope: { kind: 'project', project: 'two/project' }, selectedProject: 'one/project' } },
  ]) assert.equal(parseSessionCard({ ...plain, ...change }, key), undefined, JSON.stringify(change));
  assert.equal(parseSessionCard(plain, '../escape'), undefined);
  const view = sessionView(plain, false, 1000);
  for (const [schema, result] of [
    [sessionResults.session_list, { sessions: [view], issues: [], truncated: false }],
    [sessionResults.session_show, { session: view }],
    [sessionResults.session_archive, { instanceKey: key, archived: true }],
  ] as const) {
    assert.deepEqual(schema.parse(result), result);
    assert.throws(() => schema.parse({ ...result, extra: true }));
  }
  assert.throws(() => sessionResults.session_show.parse({ session: { ...view, card: { ...plain, extra: true } } }));
});

test('session-cards disposable cache isolates instances, preserves archives/history and reports incomplete observations', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-session-cards-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runtime = join(dir, 'runtime'), home = join(dir, 'user'), contextRoot = join(dir, 'context');
  const env = { MYPI_SESSION_DIR: runtime };
  let now = 1000;
  const cards = createSessionCards({ env, home, contextRoot, clock: () => now });
  assert.deepEqual(cards.list({ all: true }), { sessions: [], issues: [], truncated: false });
  assert.deepEqual(cards.show({ all: true, instanceKey: key }), { session: null, issue: 'missing' });
  assert.deepEqual(readdirSync(dir), [], 'inspection must not initialize runtime, DB or home');
  assert.throws(() => cards.list({}), /concrete project/);
  assert.throws(() => cards.list({}, { scope: { kind: 'organization', organization: 'one' } }), /concrete project/);
  assert.throws(() => cards.list({ all: true, project: 'one/project' }), /not both/);
  assert.throws(() => cards.list({ project: '' }), /identity/);
  assert.throws(() => cards.show({ all: true, instanceKey: '../escape' }), /instance key/);
  const nativeSessionFile = join(dir, 'native.jsonl');
  writeFileSync(nativeSessionFile, 'native history remains byte-for-byte\n');
  const old = cards.start({ ...observation, nativeSessionFile });
  now = 1100;
  const current = cards.start({ ...observation, nativeSessionFile });
  const foreign = cards.start({ ...observation, context: { scope: { kind: 'project', project: 'two/project' } } });
  const unselected = cards.start({ nativeSessionId: 'empty-not-persisted', cwd: '/task' });
  assert.notEqual(old.instanceKey, current.instanceKey, 'same native session must have distinct observations');
  assert.deepEqual(cards.list({}, observation.context).sessions.map(v => v.card.instanceKey).sort(), [old.instanceKey, current.instanceKey].sort());
  assert.equal(cards.list({}, { scope: { kind: 'unrestricted' }, selectedProject: 'one/project' }).sessions.length, 2);
  assert.equal(cards.list({ all: true }, observation.context).sessions.length, 4);
  assert.deepEqual(cards.list({ project: 'two/project' }, observation.context).sessions.map(v => v.card.instanceKey), [foreign.instanceKey]);
  assert.deepEqual(cards.show({ instanceKey: foreign.instanceKey }, observation.context), { session: null, issue: 'outside-selection' });
  assert.throws(() => cards.archive({ instanceKey: foreign.instanceKey }, observation.context), /outside-selection/);
  assert.deepEqual(cards.archive({ instanceKey: old.instanceKey }, observation.context), { instanceKey: old.instanceKey, archived: true });
  now = 1200;
  old.update('running'); old.update('heartbeat');
  assert.equal(cards.show({ all: true, instanceKey: old.instanceKey }).session!.archived, true);
  assert.equal(cards.show({ all: true, instanceKey: current.instanceKey }).session!.card.lastSeen, 1100);
  assert.equal(cards.list({}, observation.context).sessions.length, 1);
  assert.equal(cards.list({ includeArchived: true }, observation.context).sessions.length, 2);
  assert.deepEqual(cards.archive({ all: true, instanceKey: old.instanceKey }), { instanceKey: old.instanceKey, archived: true });
  old.update('close');
  const closed = readFileSync(join(runtime, 'cards', old.instanceKey + '.json'), 'utf8');
  now = 1300; old.update('running');
  assert.equal(readFileSync(join(runtime, 'cards', old.instanceKey + '.json'), 'utf8'), closed);
  current.update('settled', { nativeSessionId: observation.nativeSessionId, cwd: '/task', title: 'selection cleared' });
  assert.equal(cards.list({}, observation.context).sessions.length, 0, 'full replacement omits old context');
  assert.equal(cards.show({ all: true, instanceKey: current.instanceKey }).session!.card.title, 'selection cleared');
  assert.equal(readFileSync(nativeSessionFile, 'utf8'), 'native history remains byte-for-byte\n');
  assert.equal(existsSync(home), false); assert.equal(existsSync(contextRoot), false);
  assert.equal(statSync(join(runtime, 'cards', current.instanceKey + '.json')).mode & 0o777, 0o600);
  assert.equal(statSync(join(runtime, 'archives', old.instanceKey)).mode & 0o777, 0o600);
  assert(!readdirSync(join(runtime, 'cards')).some(name => name.endsWith('.tmp')));
  assert.throws(() => cards.start({ ...observation, title: 'x'.repeat(33 * 1024) }), /32KiB/);
  assert.equal(readdirSync(join(runtime, 'cards')).length, 4, 'oversized write creates no card');
  const broken = join(runtime, 'cards', unselected.instanceKey + '.json');
  for (const text of ['{', 'x'.repeat(33 * 1024), JSON.stringify(startSessionCard(key, observation, 1000)),
    JSON.stringify({ ...startSessionCard(unselected.instanceKey, observation, 1000), context: null })]) {
    writeFileSync(broken, text);
    assert.deepEqual(cards.show({ all: true, instanceKey: unselected.instanceKey }), { session: null, issue: 'invalid' });
    assert.deepEqual(cards.list({ all: true }).issues, [{ instanceKey: unselected.instanceKey, issue: 'invalid' }]);
  }
  rmSync(broken);
  symlinkSync(nativeSessionFile, broken);
  assert.deepEqual(cards.show({ all: true, instanceKey: unselected.instanceKey }), { session: null, issue: 'invalid' });
  rmSync(broken);
  const marker = join(runtime, 'archives', current.instanceKey);
  symlinkSync(nativeSessionFile, marker);
  assert.deepEqual(cards.show({ all: true, instanceKey: current.instanceKey }), { session: null, issue: 'invalid' });
  assert.throws(() => cards.archive({ all: true, instanceKey: current.instanceKey }), /invalid/);
  rmSync(marker);
  mkdirSync(marker);
  assert.deepEqual(cards.show({ all: true, instanceKey: current.instanceKey }), { session: null, issue: 'invalid' });
  assert.throws(() => createSessionCards({ env: { MYPI_SESSION_DIR: join(nativeSessionFile, 'child') }, home, contextRoot }), { code: 'ENOTDIR' });
  const changedParent = join(dir, 'changed-parent');
  const unavailable = createSessionCards({ env: { MYPI_SESSION_DIR: join(changedParent, 'cache') }, home, contextRoot });
  writeFileSync(changedParent, 'parent became a file after configuration');
  assert.deepEqual(unavailable.list({ all: true }), { sessions: [], issues: [{ issue: 'unavailable' }], truncated: false });
  const invalid = createSessionCards({ env: { MYPI_SESSION_DIR: nativeSessionFile }, home, contextRoot });
  assert.deepEqual(invalid.list({ all: true }), { sessions: [], issues: [{ issue: 'invalid' }], truncated: false });

  assert.equal(resolveSessionDirectory({}, home, contextRoot), join(home, '.local/state/mypi/sessions'));
  assert.equal(resolveSessionDirectory({ XDG_STATE_HOME: dir }, home, contextRoot), join(dir, 'mypi/sessions'));
  const alias = join(dir, 'alias'); mkdirSync(contextRoot); symlinkSync(contextRoot, alias);
  for (const env of [{ MYPI_SESSION_DIR: '' }, { MYPI_SESSION_DIR: 'relative' }, { XDG_STATE_HOME: 'relative' },
    { MYPI_SESSION_DIR: join(alias, 'cache') }, { MYPI_SESSION_DIR: fileURLToPath(new URL('../../../cache', import.meta.url)) }]) {
    assert.throws(() => resolveSessionDirectory(env, home, contextRoot), /absolute|outside/);
  }
  // One bounded inventory, not a subprocess or process-capability matrix.
  const bounded = join(dir, 'bounded'); mkdirSync(join(bounded, 'cards'), { recursive: true });
  for (let i = 0; i < 1001; i++) writeFileSync(join(bounded, 'cards', 'unexpected-' + i), '');
  assert.deepEqual(sessionCardFiles(bounded).scan(), { keys: [], invalid: 1000, truncated: true });
});
