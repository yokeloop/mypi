import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { warmupScope } from '../../src/app/warmup.js';
import { sessionKey } from '../../src/app/sessions.js';
import { localSessionRunner } from '../../src/app/session-operations.js';
import { hookInput, promptInput, sessionHint } from '../../src/app/session-input.js';
import { InputError } from '../../src/shared/errors.js';

const at = '2026-10-28T00:00:00.000Z';

function fixture(t: TestContext) {
  const { dir, filename } = state(t);
  const app = createApp(filename, false);
  try {
    app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git');
    app.projects.add('two/other', 'OT', undefined, 'file:///nonexistent/two/other.git');
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
  let now = Date.parse(at);
  const tick = () => new Date(now += 1000).toISOString();
  const ts = <T>(fn: (sessions: ReturnType<ReturnType<typeof createApp>['sessions']>) => T): T => {
    const app = createApp(filename, false, tick);
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
  const activity = () => {
    const db = openDatabase(filename, true);
    try {
      return Object.fromEntries((db.prepare('SELECT native_id AS nativeId, active_at AS activeAt FROM sessions').all() as { nativeId: string; activeAt: string | null }[])
        .map(r => [r.nativeId, r.activeAt]));
    } finally { db.close(); }
  };
  return { dir, filename, run, proc, sessionsDir, alive, die, s, ts, rows, files, record, claude, activity };
}

function twoLive(t: TestContext) {
  const x = fixture(t);
  x.alive(201); x.alive(202);
  x.ts(s => s.register(x.claude('c1', 201, { envScope: 'MP' })));
  x.ts(s => s.register({ agent: 'pi', nativeId: 'p2', pid: 202, name: null, socket: null, fork: false, envScope: 'MP' }));
  return x;
}

test('two live sessions of one key are both in the registry and neither is displaced', t => {
  const x = twoLive(t);
  assert.deepEqual(x.files(), ['MP~201.json', 'MP~202.json']);
  for (const name of x.files()) assert.equal(Object.hasOwn(x.record(name), 'displacedAt'), false, name);
  assert.deepEqual(x.rows().filter(r => r.key === 'MP').map(r => r.nativeId).sort(), ['c1', 'p2']);
  const found = x.ts(s => s.lookup('MP'));
  assert.deepEqual(found.records.map(r => [r.nativeId, r.pid]), [['c1', 201], ['p2', 202]]);
  assert.equal(found.row!.nativeId, 'c1');
  assert.equal(found.live!.pid, 201);
  const activity = x.activity();
  assert.equal(typeof activity['c1'], 'string');
  assert.equal(activity['p2'], null);
});

test('prompt makes its row active and a row without a live record stays closed', t => {
  const x = twoLive(t);
  const db = openDatabase(x.filename, true);
  let p2: number;
  try { p2 = db.prepare("SELECT id FROM sessions WHERE native_id = 'p2'").pluck().get() as number; } finally { db.close(); }
  assert.deepEqual(x.ts(s => s.prompt({ agent: 'pi', nativeId: 'p2' })),
    { key: 'MP', active: true, id: p2, previous: { agent: 'claude', device: hostname() }, since: null });
  const active = x.ts(s => s.lookup('MP'));
  assert.equal(active.row!.nativeId, 'p2');
  assert.equal(active.live!.pid, 202);
  x.die(202);
  const closed = x.ts(s => s.lookup('MP'));
  assert.equal(closed.live, undefined);
  assert.equal(closed.row!.nativeId, 'p2');
  const before = x.activity();
  assert.deepEqual(x.ts(s => s.prompt({ agent: 'claude', nativeId: 'nobody' })), { key: null, active: false, id: null, previous: null, since: null });
  assert.deepEqual(x.activity(), before);
});

test('prompt reports the previous active row of another session and its own last activity', t => {
  const x = twoLive(t);
  const first = x.ts(s => s.prompt({ agent: 'pi', nativeId: 'p2' }));
  assert.deepEqual([first.previous, first.since], [{ agent: 'claude', device: hostname() }, null]);
  const before = x.activity()['c1'];
  assert.equal(typeof before, 'string');
  const back = x.ts(s => s.prompt({ agent: 'claude', nativeId: 'c1' }));
  assert.deepEqual([back.previous, back.since], [{ agent: 'pi', device: hostname() }, before]);
  const last = x.activity()['c1'];
  const again = x.ts(s => s.prompt({ agent: 'claude', nativeId: 'c1' }));
  assert.deepEqual([again.previous, again.since], [null, last]);
});

test('ownRecord gives the live record of this session in its key and nothing for a closed session or a broken runtime', t => {
  const x = twoLive(t);
  assert.equal(x.ts(s => s.ownRecord('MP', { agent: 'pi', nativeId: 'p2' }))?.pid, 202);
  assert.equal(x.ts(s => s.ownRecord('OT', { agent: 'pi', nativeId: 'p2' })), undefined);
  x.die(202);
  assert.equal(x.ts(s => s.ownRecord('MP', { agent: 'pi', nativeId: 'p2' })), undefined);
  const app = createApp(x.filename, false);
  try { assert.equal(app.sessions(undefined, x.proc).ownRecord('MP', { agent: 'claude', nativeId: 'c1' }), undefined); } finally { app.close(); }
});

test('callerRow resolves the row by native id, else by the live record of the caller pid', t => {
  const x = twoLive(t);
  const db = openDatabase(x.filename, true);
  let p2: number;
  try { p2 = db.prepare("SELECT id FROM sessions WHERE native_id = 'p2'").pluck().get() as number; } finally { db.close(); }
  assert.equal(x.ts(s => s.callerRow({ agent: 'pi', nativeId: 'p2', pid: 1 })), p2);
  assert.equal(x.ts(s => s.callerRow({ agent: 'pi', nativeId: 'unknown', pid: 202 })), p2);
  assert.equal(x.ts(s => s.callerRow({ agent: 'pi', nativeId: 'unknown', pid: 999 })), undefined);
  const app = createApp(x.filename, false);
  try { assert.equal(app.sessions(undefined, x.proc).callerRow({ agent: 'pi', nativeId: 'unknown', pid: 202 }), undefined); } finally { app.close(); }
});

test('clear in the active session gives the new row active_at (decision 2)', t => {
  const x = twoLive(t);
  x.ts(s => s.register(x.claude('c3', 201, { envScope: 'MP' })));
  assert.equal(x.rows().filter(r => r.key === 'MP').length, 3);
  assert.equal(x.ts(s => s.lookup('MP')).row!.nativeId, 'c3');
  assert.deepEqual(x.files(), ['MP~201.json', 'MP~202.json']);
  assert.equal(x.record('MP~201.json')['nativeId'], 'c3');
});

test('clear in an inactive session does not take the active row (decision 2)', t => {
  const x = twoLive(t);
  x.ts(s => s.prompt({ agent: 'pi', nativeId: 'p2' }));
  x.ts(s => s.register(x.claude('c3', 201, { envScope: 'MP' })));
  assert.equal(x.ts(s => s.lookup('MP')).row!.nativeId, 'p2');
  assert.equal(x.activity()['c3'], null);
  assert.deepEqual(x.files(), ['MP~201.json', 'MP~202.json']);
});

test('a registry record without herdrName stays live and one with a non-string herdrName is pruned', t => {
  const x = fixture(t);
  x.alive(101); x.alive(102); x.alive(103);
  mkdirSync(join(x.run, 'mypi'), { mode: 0o700 });
  mkdirSync(x.sessionsDir, { mode: 0o700 });
  const stored = (key: string, nativeId: string, pid: number) => ({ key, agent: 'claude', nativeId, pid, start: '1', name: null, socket: null,
    permissionMode: null, registeredAt: at });
  writeFileSync(join(x.sessionsDir, 'MP~101.json'), JSON.stringify(stored('MP', 'c1', 101)) + '\n', { mode: 0o600 });
  writeFileSync(join(x.sessionsDir, 'OT~102.json'), JSON.stringify({ ...stored('OT', 'o2', 102), herdrName: 5 }) + '\n', { mode: 0o600 });
  x.s(s => s.register(x.claude('g3', 103)));
  assert.ok(x.files().includes('MP~101.json'));
  assert.ok(!x.files().includes('OT~102.json'));
  assert.deepEqual(x.s(s => s.lookup('MP')).records.map(r => [r.nativeId, r.pid]), [['c1', 101]]);
});

test('register stores herdrName and activate makes the row active', t => {
  const x = fixture(t);
  x.alive(101); x.alive(102); x.alive(103);
  x.ts(s => s.register({ ...x.claude('c1', 101, { envScope: 'MP-12' }), herdrName: 'mp-12' }));
  assert.equal(x.record('MP-12~101.json')['herdrName'], 'mp-12');
  x.ts(s => s.register({ agent: 'pi', nativeId: 'p2', pid: 102, name: null, socket: null, fork: false, envScope: 'MP-12' }));
  assert.equal(x.ts(s => s.lookup('MP-12')).row!.nativeId, 'c1');
  x.ts(s => s.activate({ key: 'MP-12', agent: 'pi', nativeId: 'p2' }));
  assert.equal(x.ts(s => s.lookup('MP-12')).row!.nativeId, 'p2');
  x.ts(s => s.activate({ key: 'MP-12', agent: 'claude', nativeId: 'u1' }));
  const u1 = x.ts(s => s.lookup('MP-12')).row!;
  assert.deepEqual([u1.key, u1.agent, u1.nativeId, u1.device], ['MP-12', 'claude', 'u1', hostname()]);
  const count = x.rows().length;
  x.ts(s => s.register(x.claude('u1', 103, { envScope: 'MP-12' })));
  assert.equal(x.rows().length, count);
});

test("UserPromptSubmit input counts only the engineer's own prompt", () => {
  const input = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'c1', prompt: 'привет', ...extra });
  assert.deepEqual(promptInput(input()), { nativeId: 'c1', counted: true });
  assert.deepEqual(promptInput(input({ source: 'user' })), { nativeId: 'c1', counted: true });
  for (const source of ['system', 'sdk']) assert.deepEqual(promptInput(input({ source })), { nativeId: 'c1', counted: false }, source);
  for (const prompt of ['[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение]\ngo', '  [mypi: MP-12 завершил ход',
    'Another Claude session sent a message:\n[mypi: сообщение …']) assert.deepEqual(promptInput(input({ prompt })), { nativeId: 'c1', counted: false }, prompt);
  assert.deepEqual(promptInput(input({ prompt: 'посмотри [mypi: x' })), { nativeId: 'c1', counted: true });
  for (const text of ['not json', input({ hook_event_name: 'Stop' }), input({ session_id: '' }), input({ prompt: 1 }), input({ source: 1 })])
    assert.throws(() => promptInput(text), (error: unknown) => error instanceof InputError && error.message === 'Invalid UserPromptSubmit hook input', text);
});

test('registry files are owner-only, liveness needs pid and start, dead and malformed records are removed only by writers', t => {
  const { run, sessionsDir, alive, s, files, record, claude } = fixture(t);
  alive(101, '500');
  assert.deepEqual(s(x => x.register({ agent: 'claude', nativeId: 'c1', pid: 101, name: 'mp-12', socket: '/run/s.sock', fork: false, envScope: 'MP-12' })),
    { key: 'MP-12', registered: true });
  assert.equal(statSync(join(run, 'mypi')).mode & 0o777, 0o700);
  assert.equal(statSync(sessionsDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(sessionsDir, 'MP-12~101.json')).mode & 0o777, 0o600);
  assert.deepEqual(record('MP-12~101.json'), { key: 'MP-12', agent: 'claude', nativeId: 'c1', pid: 101, start: '500', name: 'mp-12',
    socket: '/run/s.sock', permissionMode: null, registeredAt: at });
  alive(101, '501');
  alive(102);
  writeFileSync(join(sessionsDir, 'OT~5.json'), 'not json');
  writeFileSync(join(sessionsDir, 'MP.json'), JSON.stringify({ key: 'MP', agent: 'claude', nativeId: 'old', pid: 102, start: '1', name: null,
    socket: null, permissionMode: null, registeredAt: at }));
  writeFileSync(join(sessionsDir, 'notes.txt'), 'keep');
  const tree = s(x => x.tree());
  assert.deepEqual(tree.children[0]!.children[0]!.children[0], { key: 'MP-12', session: { agent: 'claude', nativeId: 'c1', state: 'closed' },
    sessions: [{ agent: 'claude', nativeId: 'c1', device: hostname(), activeAt: at, state: 'closed' }], children: [] });
  assert.equal(s(x => x.resolve({ agent: 'claude', nativeId: 'other', pid: 101 })), undefined);
  assert.equal(s(x => x.lookup('MP')).live, undefined);
  assert.deepEqual(files(), ['MP-12~101.json', 'MP.json', 'OT~5.json', 'notes.txt']);
  s(x => x.register(claude('g1', 102)));
  assert.deepEqual(files(), ['global~102.json', 'notes.txt']);
});

test("permission mode is read only from the agent's own command line", t => {
  const { alive, s, record, sessionsDir, claude } = fixture(t);
  alive(102, '1', ['claude', '--permission-mode', 'plan', '--api-key', 'secret-value']);
  s(x => x.register(claude('c1', 102)));
  assert.equal(record('global~102.json')['permissionMode'], 'plan');
  assert.ok(!readFileSync(join(sessionsDir, 'global~102.json'), 'utf8').includes('secret-value'));
  const cases: [string[], string | null][] = [[['claude', '--permission-mode=auto'], 'auto'],
    [['claude', '--dangerously-skip-permissions'], 'bypassPermissions'], [['claude'], null]];
  for (const [argv, mode] of cases) {
    alive(102, '1', argv);
    s(x => x.register(claude('c1', 102)));
    assert.equal(record('global~102.json')['permissionMode'], mode, argv.join(' '));
  }
  alive(103, '1', ['pi', '--permission-mode', 'plan']);
  s(x => x.register({ agent: 'pi', nativeId: 'p1', pid: 103, name: null, socket: null, fork: false }));
  assert.equal(record('global~103.json')['permissionMode'], null);
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
  const { filename, alive, s, rows, files, record, claude } = fixture(t);
  alive(101);
  const cases: [ReturnType<typeof claude>, RegExp][] = [
    [claude('c1', 999), /Process 999 is not running/],
    [claude('', 101), /Invalid native session id/],
    [claude('c1', 101, { envScope: 'XX' }), /Unknown project: XX/],
    [claude('c1', 101, { envScope: 'MP-99' }), /Unknown task: MP-99/],
    [claude('c1', 101, { envScope: 'REQ-1' }), /has no project/],
    [claude('c1', 101, { envScope: 'Mp' }), /Invalid session key: Mp; use global, an organization slug \(tb-ff\), a project code \(MP\) or a task key \(MP-12\)/],
    [claude('c1', 101, { envScope: 'nope' }), /Unknown organization/],
    [claude('c1', 101, { envScope: 'all' }), /all is reserved for \/inbox all and is not a session key/],
  ];
  for (const [input, error] of cases) {
    assert.throws(() => s(x => x.register(input)), error);
    assert.deepEqual(rows(), []);
    assert.deepEqual(files(), []);
  }
  assert.deepEqual(s(x => x.register(claude('c1', 101, { envScope: 'one' }))), { key: 'one', registered: true });
  const db = openDatabase(filename, true);
  try {
    assert.deepEqual(db.prepare('SELECT key, scope_type AS scopeType, org_id AS orgId, project_id AS projectId, task_id AS taskId FROM sessions').all(),
      [{ key: 'one', scopeType: 'org', orgId: (db.prepare("SELECT id FROM organizations WHERE slug = 'one'").get() as { id: number }).id,
        projectId: null, taskId: null }]);
  } finally { db.close(); }
  assert.deepEqual(files(), ['one~101.json']);
  assert.equal(record('one~101.json')['key'], 'one');
  assert.equal(s(x => x.lookup('one')).live!.pid, 101);
  assert.equal(s(x => x.resolve({ agent: 'claude', nativeId: 'other', pid: 101 })), 'one');
});

test("unregister removes only the caller's own records and keeps the row", t => {
  const { alive, die, s, rows, files, record, claude } = fixture(t);
  alive(101); alive(201);
  s(x => x.register(claude('c1', 101, { envScope: 'MP-12' })));
  s(x => x.register(claude('g1', 201)));
  assert.deepEqual(s(x => x.unregister(101)), { removed: ['MP-12'] });
  assert.deepEqual(files(), ['global~201.json']);
  assert.deepEqual(rows().map(r => r.key), ['MP-12', 'global']);
  assert.equal(s(x => x.tree()).children[0]!.children[0]!.children[0]!.session!.state, 'closed');
  assert.deepEqual(s(x => x.unregister(101)), { removed: [] });
  die(101);
  assert.deepEqual(s(x => x.unregister(101)), { removed: [] });
  alive(202);
  s(x => x.register(claude('g2', 202)));
  assert.deepEqual(files(), ['global~201.json', 'global~202.json']);
  assert.deepEqual(s(x => x.unregister(201)), { removed: ['global'] });
  assert.deepEqual(files(), ['global~202.json']);
  assert.equal(record('global~202.json')['pid'], 202);
});

test('forget deletes every row of the key and reports a live session without touching its records', t => {
  const { alive, die, s, rows, files, claude } = fixture(t);
  alive(101); alive(102); alive(201);
  s(x => x.register(claude('c1', 101, { envScope: 'MP-12' })));
  s(x => x.register({ agent: 'pi', nativeId: 'p2', pid: 102, name: null, socket: null, fork: false, envScope: 'MP-12' }));
  s(x => x.register(claude('g1', 201)));
  die(101);
  assert.deepEqual(s(x => x.forget('MP-12')), { forgotten: 'MP-12', live: true });
  assert.deepEqual(rows().map(r => r.key), ['global']);
  assert.deepEqual(files(), ['MP-12~102.json', 'global~201.json']);
  assert.throws(() => s(x => x.forget('MP-12')), /Unknown session: MP-12/);
  die(201);
  s(x => x.tree());
  assert.deepEqual(files(), ['MP-12~102.json', 'global~201.json']);
  assert.deepEqual(s(x => x.forget('global')), { forgotten: 'global', live: false });
  assert.deepEqual(files(), ['MP-12~102.json']);
});

test('lookup returns the active row, its live record and every live record of the key', t => {
  const { alive, die, ts, claude } = fixture(t);
  assert.deepEqual(ts(x => x.lookup('MP-12')), { row: undefined, live: undefined, records: [], rows: [] });
  alive(101, '1', ['claude', '--permission-mode', 'plan']);
  ts(x => x.register(claude('c1', 101, { envScope: 'MP-12' })));
  const first = ts(x => x.lookup('MP-12'));
  assert.equal(first.row!.agent, 'claude');
  assert.equal(first.row!.nativeId, 'c1');
  assert.equal(first.live!.pid, 101);
  assert.equal(first.live!.permissionMode, 'plan');
  assert.deepEqual(first.records.map(r => r.pid), [101]);
  alive(102);
  ts(x => x.register(claude('c2', 102, { envScope: 'MP-12' })));
  const second = ts(x => x.lookup('MP-12'));
  assert.equal(second.row!.nativeId, 'c1');
  assert.equal(second.live!.pid, 101);
  assert.deepEqual(second.records.map(r => r.pid), [101, 102]);
  ts(x => x.prompt({ agent: 'claude', nativeId: 'c2' }));
  const prompted = ts(x => x.lookup('MP-12'));
  assert.equal(prompted.row!.nativeId, 'c2');
  assert.equal(prompted.live!.pid, 102);
  assert.deepEqual(prompted.records.map(r => r.pid), [102, 101]);
  die(102);
  const closed = ts(x => x.lookup('MP-12'));
  assert.equal(closed.live, undefined);
  assert.equal(closed.row!.nativeId, 'c2');
  assert.deepEqual(closed.records.map(r => r.pid), [101]);
});

test('sessions tree is global → org → project → task with live and closed', t => {
  const { alive, die, s, claude } = fixture(t);
  alive(201); alive(301); alive(101); alive(401); alive(501);
  s(x => x.register(claude('g1', 201)));
  s(x => x.register({ agent: 'pi', nativeId: 'p12', pid: 301, name: null, socket: null, fork: false, envScope: 'MP-12' }));
  die(301);
  s(x => x.register(claude('c7', 101, { envScope: 'MP-7' })));
  s(x => x.register({ agent: 'pi', nativeId: 'pot', pid: 401, name: null, socket: null, fork: false, envScope: 'OT' }));
  s(x => x.register(claude('c2', 501, { envScope: 'two' })));
  const one = (agent: 'claude' | 'pi', nativeId: string, state: 'live' | 'closed') =>
    ({ session: { agent, nativeId, state }, sessions: [{ agent, nativeId, device: hostname(), activeAt: at, state }] });
  const mp = { key: 'MP', session: null, sessions: [], children: [
    { key: 'MP-7', ...one('claude', 'c7', 'live'), children: [] },
    { key: 'MP-12', ...one('pi', 'p12', 'closed'), children: [] }] };
  const ot = { key: 'OT', ...one('pi', 'pot', 'live'), children: [] };
  assert.deepEqual(s(x => x.tree()), { key: 'global', ...one('claude', 'g1', 'live'), children: [
    { key: 'one', session: null, sessions: [], children: [mp] },
    { key: 'two', ...one('claude', 'c2', 'live'), children: [ot] }] });
  die(501);
  assert.deepEqual(s(x => x.tree()).children[1], { key: 'two', ...one('claude', 'c2', 'closed'), children: [ot] });
  s(x => x.forget('OT'));
  assert.deepEqual(s(x => x.tree()).children[1], { key: 'two', ...one('claude', 'c2', 'closed'), children: [] });
  const empty = fixture(t);
  assert.deepEqual(empty.s(x => x.tree()), { key: 'global', session: null, sessions: [], children: [] });
});

test('a task with two sessions is one node with both sessions, the active one first', t => {
  const x = twoLive(t);
  x.alive(301);
  x.ts(s => s.register(x.claude('c7', 301, { envScope: 'MP-7' })));
  x.alive(302);
  x.ts(s => s.register({ agent: 'pi', nativeId: 'p7', pid: 302, name: null, socket: null, fork: false, envScope: 'MP-7' }));
  x.ts(s => s.prompt({ agent: 'pi', nativeId: 'p7' }));
  const project = x.ts(s => s.tree()).children[0]!.children[0]!;
  assert.deepEqual(project.sessions.map(r => [r.nativeId, r.state]), [['c1', 'live'], ['p2', 'live']]);
  assert.deepEqual(project.children.map(c => c.key), ['MP-7']);
  assert.deepEqual(project.children[0]!.session, { agent: 'pi', nativeId: 'p7', state: 'live' });
  assert.deepEqual(project.children[0]!.sessions.map(r => r.nativeId), ['p7', 'c7']);
});

test('session key resolution scenarios', async t => {
  const setup = (t: TestContext) => {
    const f = fixture(t);
    const register = (agent: 'claude' | 'pi', nativeId: string, pid: number, extra: { envScope?: string; fork?: boolean } = {}) =>
      f.ts(x => x.register({ agent, nativeId, pid, name: null, socket: null, fork: false, ...extra }));
    const warm = async (agent: 'claude' | 'pi', nativeId: string, pid: number, envScope?: string) =>
      warmupScope(undefined, envScope, await sessionKey(localSessionRunner(f.filename), { agent, nativeId, pid, runtime: f.run }, f.proc));
    const row = (key: string) => f.ts(x => x.lookup(key)).row;
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
  await t.test('1: /open MP-12, a new session', async t => {
    const x = opened(t);
    assert.deepEqual(x.result, { key: 'MP-12', registered: true });
    assert.equal(await x.warm('claude', 'c1', 900, 'MP-12'), 'MP-12');
    assert.equal(x.row('MP-12')!.nativeId, 'c1');
  });
  await t.test('2: the /open session, then /clear', async t => {
    const x = cleared(t);
    assert.deepEqual(x.result, { key: 'MP-12', registered: true });
    assert.equal(await x.warm('claude', 'c2', 900, 'MP-12'), 'MP-12');
    assert.equal(x.row('MP-12')!.nativeId, 'c2');
    assert.deepEqual(x.files(), ['MP-12~101.json']);
  });
  await t.test('3: claude --resume of the task id by hand in the root', async t => {
    const x = resumed(t);
    assert.equal(x.result.key, 'MP-12');
    assert.equal(await x.warm('claude', 'c2', 900), 'MP-12');
    assert.equal(x.record('MP-12~102.json')['nativeId'], 'c2');
    assert.equal(x.row('MP-12')!.nativeId, 'c2');
  });
  await t.test('4: case 3, then /clear', async t => {
    const x = resumedCleared(t);
    assert.equal(x.result.key, 'MP-12');
    assert.equal(await x.warm('claude', 'c3', 900), 'MP-12');
    assert.equal(x.row('MP-12')!.nativeId, 'c3');
  });
  await t.test('5: MCP after /clear with a stale id', async t => {
    const x = resumedCleared(t);
    assert.equal(await x.warm('claude', 'c2', 102), 'MP-12');
  });
  await t.test('6: a second hand claude in the root', async t => {
    const x = setup(t);
    x.alive(201); x.alive(202);
    assert.equal(x.register('claude', 'g1', 201).key, 'global');
    assert.deepEqual(x.register('claude', 'g2', 202), { key: 'global', registered: true });
    assert.deepEqual(x.files(), ['global~201.json', 'global~202.json']);
    assert.equal(x.record('global~202.json')['nativeId'], 'g2');
    assert.equal(x.row('global')!.nativeId, 'g1');
    assert.equal(await x.warm('claude', 'g2', 900), 'global');
  });
  await t.test('7: Pi /new in a task session', async t => {
    const x = setup(t);
    x.alive(300);
    x.register('pi', 'p0', 300, { envScope: 'MP-12' });
    x.die(300); x.alive(301);
    assert.deepEqual(x.register('pi', 'p0', 301), { key: 'MP-12', registered: true });
    assert.deepEqual(x.register('pi', 'p1', 301), { key: 'MP-12', registered: true });
    assert.deepEqual(x.files(), ['MP-12~301.json']);
    assert.equal(x.row('MP-12')!.nativeId, 'p1');
    assert.equal(await x.warm('pi', 'p1', 301), 'MP-12');
  });
  await t.test('8: a hand fork without MYPI_SCOPE', async t => {
    const x = setup(t);
    x.alive(201);
    x.register('claude', 'g1', 201);
    x.alive(401);
    assert.deepEqual(x.register('claude', 'f1', 401, { fork: true }), { key: 'global', registered: false });
    assert.deepEqual(x.files(), ['global~201.json']);
    assert.equal(x.rows().some(r => r.nativeId === 'f1'), false);
    assert.equal(await x.warm('claude', 'f1', 401), 'global');
    x.alive(101);
    x.register('claude', 'c1', 101, { envScope: 'MP-12' });
    x.alive(402);
    const fork = x.register('claude', 'f2', 402, { fork: true, envScope: 'MP-12' });
    assert.deepEqual(fork, { key: 'MP-12', registered: true });
    assert.deepEqual(x.files(), ['MP-12~101.json', 'MP-12~402.json', 'global~201.json']);
    assert.equal(x.row('MP-12')!.nativeId, 'c1');
  });
  await t.test('9: claude --resume of the MP-7 id in an MP-12 tab', async t => {
    const x = setup(t);
    x.alive(501);
    x.register('claude', 'c7', 501, { envScope: 'MP-7' });
    x.die(501); x.alive(101);
    x.register('claude', 'c1', 101, { envScope: 'MP-12' });
    x.alive(502);
    assert.deepEqual(x.register('claude', 'c7', 502, { envScope: 'MP-12' }), { key: 'MP-7', registered: true });
    assert.equal(await x.warm('claude', 'c7', 502, 'MP-12'), 'MP-7');
    assert.equal(x.record('MP-12~101.json')['nativeId'], 'c1');
  });
  assert.equal(warmupScope('MP', 'MP-12', 'MP-7'), 'MP');
  const x = opened(t);
  assert.equal(await sessionKey(localSessionRunner(x.filename), { agent: 'claude', nativeId: 'c1', pid: 101 }, x.proc), 'MP-12');
  assert.equal(await sessionKey(localSessionRunner(x.filename), { agent: 'claude', nativeId: 'nobody', pid: 101 }, x.proc), undefined);
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
