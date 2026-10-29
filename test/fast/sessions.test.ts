import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { warmupScope } from '../../src/app/warmup.js';
import { sessionKey } from '../../src/app/sessions.js';
import { hookInput, sessionHint } from '../../src/app/session-input.js';

const at = '2026-10-28T00:00:00.000Z';

function fixture(t: TestContext) {
  const { dir, filename } = state(t);
  const app = createApp(filename, false);
  try {
    app.projects.add('one/project', 'MP');
    app.projects.add('two/other', 'OT');
  } finally { app.close(); }
  const tasks: [string | null, number, string][] = [['MP', 7, 'started'], ['MP', 12, 'scoped-warmup'], [null, 1, 'legacy']];
  const identities: Record<string, string> = { MP: 'one/project', OT: 'two/other' };
  const db = openDatabase(filename);
  try {
    for (const [code, number, slug] of tasks) {
      const contextDir = code === null ? 'tasks/REQ-' + number + '-' + slug
        : 'projects/' + identities[code] + '/tasks/' + code + '-' + number + '-' + slug;
      db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
        VALUES ((SELECT id FROM projects WHERE code = ?), ?, ?, (SELECT id FROM task_statuses WHERE code = 'new'), ?, NULL,
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run(code, number, slug, contextDir);
    }
  } finally { db.close(); }
  const run = join(dir, 'run'), proc = join(dir, 'proc');
  mkdirSync(run, { mode: 0o700 });
  mkdirSync(proc);
  const sessionsDir = join(run, 'mypi', 'sessions');
  const alive = (pid: number, start = '1', argv = ['claude']) => {
    mkdirSync(join(proc, String(pid)), { recursive: true });
    writeFileSync(join(proc, String(pid), 'stat'), `${pid} (cl (a) ude) S 1 ${'0 '.repeat(17)}${start} 0 0\n`);
    writeFileSync(join(proc, String(pid), 'cmdline'), argv.join('\0') + '\0');
  };
  const die = (pid: number) => rmSync(join(proc, String(pid)), { recursive: true, force: true });
  const s = <T>(fn: (sessions: ReturnType<ReturnType<typeof createApp>['sessions']>) => T): T => {
    const app = createApp(filename, false, () => at);
    try { return fn(app.sessions(run, proc)); } finally { app.close(); }
  };
  const rows = () => {
    const db = openDatabase(filename, true);
    try {
      return db.prepare('SELECT key, agent, native_id AS nativeId FROM sessions ORDER BY key').all() as { key: string; agent: string; nativeId: string }[];
    } finally { db.close(); }
  };
  const files = () => existsSync(sessionsDir) ? readdirSync(sessionsDir).sort() : [];
  const record = (name: string) => JSON.parse(readFileSync(join(sessionsDir, name), 'utf8')) as Record<string, unknown>;
  const claude = (nativeId: string, pid: number, extra: { envScope?: string; fork?: boolean } = {}) =>
    ({ agent: 'claude' as const, nativeId, pid, name: null, socket: null, fork: false, ...extra });
  return { dir, filename, run, proc, sessionsDir, alive, die, s, rows, files, record, claude };
}

test('registry files are owner-only, liveness needs pid and start, dead and malformed records are removed only by writers', t => {
  const { run, sessionsDir, alive, s, files, record, claude } = fixture(t);
  alive(101, '500');
  assert.deepEqual(s(x => x.register({ agent: 'claude', nativeId: 'c1', pid: 101, name: 'mp-12', socket: '/run/s.sock', fork: false, envScope: 'MP-12' })),
    { key: 'MP-12', registered: true, displaced: null });
  assert.equal(statSync(join(run, 'mypi')).mode & 0o777, 0o700);
  assert.equal(statSync(sessionsDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(sessionsDir, 'MP-12.json')).mode & 0o777, 0o600);
  assert.deepEqual(record('MP-12.json'), { key: 'MP-12', agent: 'claude', nativeId: 'c1', pid: 101, start: '500', name: 'mp-12',
    socket: '/run/s.sock', permissionMode: null, registeredAt: at });
  alive(101, '501');
  writeFileSync(join(sessionsDir, 'OT.json'), 'not json');
  writeFileSync(join(sessionsDir, 'notes.txt'), 'keep');
  const tree = s(x => x.tree());
  assert.deepEqual(tree.children[0]!.children[0], { key: 'MP-12', session: { agent: 'claude', nativeId: 'c1', state: 'closed' }, children: [] });
  assert.equal(s(x => x.resolve({ agent: 'claude', nativeId: 'other', pid: 101 })), undefined);
  assert.deepEqual(files(), ['MP-12.json', 'OT.json', 'notes.txt']);
  alive(102);
  s(x => x.register(claude('g1', 102)));
  assert.deepEqual(files(), ['global.json', 'notes.txt']);
});

test("permission mode is read only from the agent's own command line", t => {
  const { alive, s, record, sessionsDir, claude } = fixture(t);
  alive(102, '1', ['claude', '--permission-mode', 'plan', '--api-key', 'secret-value']);
  s(x => x.register(claude('c1', 102)));
  assert.equal(record('global.json')['permissionMode'], 'plan');
  assert.ok(!readFileSync(join(sessionsDir, 'global.json'), 'utf8').includes('secret-value'));
  const cases: [string[], string | null][] = [[['claude', '--permission-mode=auto'], 'auto'],
    [['claude', '--dangerously-skip-permissions'], 'bypassPermissions'], [['claude'], null]];
  for (const [argv, mode] of cases) {
    alive(102, '1', argv);
    s(x => x.register(claude('c1', 102)));
    assert.equal(record('global.json')['permissionMode'], mode, argv.join(' '));
  }
  alive(103, '1', ['pi', '--permission-mode', 'plan']);
  s(x => x.register({ agent: 'pi', nativeId: 'p1', pid: 103, name: null, socket: null, fork: false }));
  assert.equal(record('global.json')['permissionMode'], null);
});

test('the registry refuses an unsafe directory and a missing XDG_RUNTIME_DIR', t => {
  const { dir, filename, run, proc, alive, s, claude } = fixture(t);
  alive(101);
  const other = join(dir, 'other');
  mkdirSync(other, { mode: 0o700 });
  symlinkSync(other, join(run, 'mypi'));
  assert.throws(() => s(x => x.register(claude('c1', 101))), /Unsafe session registry directory/);
  rmSync(join(run, 'mypi'));
  mkdirSync(join(run, 'mypi'));
  chmodSync(join(run, 'mypi'), 0o755);
  assert.throws(() => s(x => x.register(claude('c1', 101))), /Unsafe session registry directory/);
  for (const runtime of [undefined, 'relative']) {
    const app = createApp(filename, false);
    try {
      assert.throws(() => app.sessions(runtime, proc).register(claude('c1', 101)), /XDG_RUNTIME_DIR must be an absolute path/);
    } finally { app.close(); }
  }
});

test('register validates the process, the native id and the key', t => {
  const { alive, s, rows, files, claude } = fixture(t);
  alive(101);
  const cases: [ReturnType<typeof claude>, RegExp][] = [
    [claude('c1', 999), /Process 999 is not running/],
    [claude('', 101), /Invalid native session id/],
    [claude('c1', 101, { envScope: 'XX' }), /Unknown project: XX/],
    [claude('c1', 101, { envScope: 'MP-99' }), /Unknown task: MP-99/],
    [claude('c1', 101, { envScope: 'REQ-1' }), /has no project/],
    [claude('c1', 101, { envScope: 'mp' }), /Invalid session key/],
  ];
  for (const [input, error] of cases) {
    assert.throws(() => s(x => x.register(input)), error);
    assert.deepEqual(rows(), []);
    assert.deepEqual(files(), []);
  }
});

test("unregister removes only the caller's own records and keeps the row", t => {
  const { alive, die, s, rows, files, record, claude } = fixture(t);
  alive(101); alive(201);
  s(x => x.register(claude('c1', 101, { envScope: 'MP-12' })));
  s(x => x.register(claude('g1', 201)));
  assert.deepEqual(s(x => x.unregister(101)), { removed: ['MP-12'] });
  assert.deepEqual(files(), ['global.json']);
  assert.deepEqual(rows().map(r => r.key), ['MP-12', 'global']);
  assert.equal(s(x => x.tree()).children[0]!.children[0]!.session!.state, 'closed');
  assert.deepEqual(s(x => x.unregister(101)), { removed: [] });
  die(101);
  assert.deepEqual(s(x => x.unregister(101)), { removed: [] });
  alive(202);
  s(x => x.register(claude('g2', 202)));
  assert.deepEqual(files(), ['global.json', 'global~201.json']);
  assert.deepEqual(s(x => x.unregister(201)), { removed: ['global'] });
  assert.deepEqual(files(), ['global.json']);
  assert.equal(record('global.json')['pid'], 202);
});

test('forget deletes the row and reports a live session without touching its record', t => {
  const { alive, die, s, rows, files, claude } = fixture(t);
  alive(101); alive(201);
  s(x => x.register(claude('c1', 101, { envScope: 'MP-12' })));
  s(x => x.register(claude('g1', 201)));
  assert.deepEqual(s(x => x.forget('MP-12')), { forgotten: 'MP-12', live: true });
  assert.deepEqual(rows().map(r => r.key), ['global']);
  assert.deepEqual(files(), ['MP-12.json', 'global.json']);
  assert.throws(() => s(x => x.forget('MP-12')), /Unknown session: MP-12/);
  die(201);
  s(x => x.tree());
  assert.deepEqual(files(), ['MP-12.json', 'global.json']);
  assert.deepEqual(s(x => x.forget('global')), { forgotten: 'global', live: false });
  assert.deepEqual(files(), ['MP-12.json']);
});

test('lookup returns the saved row and only the canonical live record', t => {
  const { alive, die, s, claude } = fixture(t);
  assert.deepEqual(s(x => x.lookup('MP-12')), { row: undefined, live: undefined });
  alive(101, '1', ['claude', '--permission-mode', 'plan']);
  s(x => x.register(claude('c1', 101, { envScope: 'MP-12' })));
  const first = s(x => x.lookup('MP-12'));
  assert.equal(first.row!.agent, 'claude');
  assert.equal(first.row!.nativeId, 'c1');
  assert.equal(first.live!.pid, 101);
  assert.equal(first.live!.permissionMode, 'plan');
  alive(102);
  s(x => x.register(claude('c2', 102, { envScope: 'MP-12' })));
  assert.equal(s(x => x.lookup('MP-12')).live!.pid, 102);
  die(102);
  const closed = s(x => x.lookup('MP-12'));
  assert.equal(closed.live, undefined);
  assert.equal(closed.row!.nativeId, 'c2');
});

test('sessions tree is global → project → task with live and closed', t => {
  const { alive, die, s, claude } = fixture(t);
  alive(201); alive(301); alive(101); alive(401);
  s(x => x.register(claude('g1', 201)));
  s(x => x.register({ agent: 'pi', nativeId: 'p12', pid: 301, name: null, socket: null, fork: false, envScope: 'MP-12' }));
  die(301);
  s(x => x.register(claude('c7', 101, { envScope: 'MP-7' })));
  s(x => x.register({ agent: 'pi', nativeId: 'pot', pid: 401, name: null, socket: null, fork: false, envScope: 'OT' }));
  assert.deepEqual(s(x => x.tree()), { key: 'global', session: { agent: 'claude', nativeId: 'g1', state: 'live' }, children: [
    { key: 'MP', session: null, children: [
      { key: 'MP-7', session: { agent: 'claude', nativeId: 'c7', state: 'live' }, children: [] },
      { key: 'MP-12', session: { agent: 'pi', nativeId: 'p12', state: 'closed' }, children: [] }] },
    { key: 'OT', session: { agent: 'pi', nativeId: 'pot', state: 'live' }, children: [] }] });
  const empty = fixture(t);
  assert.deepEqual(empty.s(x => x.tree()), { key: 'global', session: null, children: [] });
});

test('session key resolution scenarios', async t => {
  const setup = (t: TestContext) => {
    const f = fixture(t);
    const register = (agent: 'claude' | 'pi', nativeId: string, pid: number, extra: { envScope?: string; fork?: boolean } = {}) =>
      f.s(x => x.register({ agent, nativeId, pid, name: null, socket: null, fork: false, ...extra }));
    const warm = (agent: 'claude' | 'pi', nativeId: string, pid: number, envScope?: string) =>
      warmupScope(undefined, envScope, sessionKey(f.filename, { agent, nativeId, pid, runtime: f.run }, f.proc));
    const row = (key: string) => f.rows().find(r => r.key === key);
    return { ...f, register, warm, row };
  };
  const opened = (t: TestContext) => {
    const x = setup(t);
    x.alive(101);
    const result = x.register('claude', 'c1', 101, { envScope: 'MP-12' });
    return { ...x, result };
  };
  const cleared = (t: TestContext) => {
    const x = opened(t);
    return { ...x, result: x.register('claude', 'c2', 101, { envScope: 'MP-12' }) };
  };
  const resumed = (t: TestContext) => {
    const x = cleared(t);
    x.die(101); x.alive(102);
    return { ...x, result: x.register('claude', 'c2', 102) };
  };
  const resumedCleared = (t: TestContext) => {
    const x = resumed(t);
    return { ...x, result: x.register('claude', 'c3', 102) };
  };
  await t.test('1: /open MP-12, a new session', t => {
    const x = opened(t);
    assert.deepEqual(x.result, { key: 'MP-12', registered: true, displaced: null });
    assert.equal(x.warm('claude', 'c1', 900, 'MP-12'), 'MP-12');
    assert.equal(x.row('MP-12')!.nativeId, 'c1');
  });
  await t.test('2: the /open session, then /clear', t => {
    const x = cleared(t);
    assert.deepEqual(x.result, { key: 'MP-12', registered: true, displaced: null });
    assert.equal(x.warm('claude', 'c2', 900, 'MP-12'), 'MP-12');
    assert.equal(x.row('MP-12')!.nativeId, 'c2');
    assert.ok(!x.files().includes('MP-12~101.json'));
  });
  await t.test('3: claude --resume of the task id by hand in the root', t => {
    const x = resumed(t);
    assert.equal(x.result.key, 'MP-12');
    assert.equal(x.warm('claude', 'c2', 900), 'MP-12');
    assert.equal(x.record('MP-12.json')['pid'], 102);
  });
  await t.test('4: case 3, then /clear', t => {
    const x = resumedCleared(t);
    assert.equal(x.result.key, 'MP-12');
    assert.equal(x.warm('claude', 'c3', 900), 'MP-12');
    assert.equal(x.row('MP-12')!.nativeId, 'c3');
  });
  await t.test('5: MCP after /clear with a stale id', t => {
    const x = resumedCleared(t);
    assert.equal(x.warm('claude', 'c2', 102), 'MP-12');
  });
  await t.test('6: a second hand claude in the root', t => {
    const x = setup(t);
    x.alive(201); x.alive(202);
    assert.equal(x.register('claude', 'g1', 201).key, 'global');
    const second = x.register('claude', 'g2', 202);
    assert.equal(second.key, 'global');
    assert.equal(second.displaced!.pid, 201);
    assert.equal(typeof second.displaced!.displacedAt, 'string');
    assert.equal(x.record('global.json')['pid'], 202);
    assert.ok(x.files().includes('global~201.json'));
    assert.equal(x.row('global')!.nativeId, 'g2');
    assert.equal(x.warm('claude', 'g2', 900), 'global');
  });
  await t.test('7: Pi /new in a task session', t => {
    const x = setup(t);
    x.alive(300);
    x.register('pi', 'p0', 300, { envScope: 'MP-12' });
    x.die(300); x.alive(301);
    assert.deepEqual(x.register('pi', 'p0', 301), { key: 'MP-12', registered: true, displaced: null });
    assert.deepEqual(x.register('pi', 'p1', 301), { key: 'MP-12', registered: true, displaced: null });
    assert.equal(x.row('MP-12')!.nativeId, 'p1');
    assert.equal(x.warm('pi', 'p1', 301), 'MP-12');
  });
  await t.test('8: a hand fork without MYPI_SCOPE', t => {
    const x = setup(t);
    x.alive(201);
    x.register('claude', 'g1', 201);
    x.alive(401);
    assert.deepEqual(x.register('claude', 'f1', 401, { fork: true }), { key: 'global', registered: false, displaced: null });
    assert.equal(x.record('global.json')['pid'], 201);
    assert.equal(x.rows().some(r => r.nativeId === 'f1'), false);
    assert.equal(x.warm('claude', 'f1', 401), 'global');
    x.alive(101);
    x.register('claude', 'c1', 101, { envScope: 'MP-12' });
    x.alive(402);
    const fork = x.register('claude', 'f2', 402, { fork: true, envScope: 'MP-12' });
    assert.equal(fork.registered, true);
    assert.equal(fork.displaced!.pid, 101);
  });
  await t.test('9: claude --resume of the MP-7 id in an MP-12 tab', t => {
    const x = setup(t);
    x.alive(501);
    x.register('claude', 'c7', 501, { envScope: 'MP-7' });
    x.die(501); x.alive(101);
    x.register('claude', 'c1', 101, { envScope: 'MP-12' });
    x.alive(502);
    assert.deepEqual(x.register('claude', 'c7', 502, { envScope: 'MP-12' }), { key: 'MP-7', registered: true, displaced: null });
    assert.equal(x.warm('claude', 'c7', 502, 'MP-12'), 'MP-7');
    assert.equal(x.record('MP-12.json')['pid'], 101);
  });
  assert.equal(warmupScope('MP', 'MP-12', 'MP-7'), 'MP');
  const x = opened(t);
  assert.equal(sessionKey(x.filename, { agent: 'claude', nativeId: 'c1', pid: 101 }, x.proc), 'MP-12');
  assert.equal(sessionKey(x.filename, { agent: 'claude', nativeId: 'nobody', pid: 101 }, x.proc), undefined);
});

test('SessionStart hook input and the environment hint', () => {
  assert.deepEqual(hookInput('{"session_id":"c1","source":"fork","session_title":"mp-12","cwd":"/x"}'), { nativeId: 'c1', name: 'mp-12', fork: true });
  assert.deepEqual(hookInput('{"session_id":"c1","source":"clear"}'), { nativeId: 'c1', fork: false });
  for (const text of ['{}', '[]', '{"session_id":"c1","source":"other"}', '{"session_id":"","source":"startup"}'])
    assert.throws(() => hookInput(text), /Invalid SessionStart hook input/);
  assert.deepEqual(sessionHint({ CLAUDE_CODE_SESSION_ID: 'c1', PI_SESSION_ID: 'p1', XDG_RUNTIME_DIR: '/run/user/1' }, 42),
    { agent: 'claude', nativeId: 'c1', pid: 42, runtime: '/run/user/1' });
  assert.deepEqual(sessionHint({ PI_SESSION_ID: 'p1' }, 42), { agent: 'pi', nativeId: 'p1', pid: 42 });
  assert.equal(sessionHint({ CLAUDE_CODE_SESSION_ID: '', PI_SESSION_ID: '', XDG_RUNTIME_DIR: '' }, 42), undefined);
});
