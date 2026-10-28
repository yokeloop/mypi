import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';

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

test('registry files are owner-only, liveness needs pid and start, dead and malformed records are removed', t => {
  const { run, sessionsDir, alive, s, files, record } = fixture(t);
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
  assert.deepEqual(files(), ['notes.txt']);
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
  assert.deepEqual(s(x => x.forget('global')), { forgotten: 'global', live: false });
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
