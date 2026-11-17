import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { localSessionRunner } from '../../src/app/session-operations.js';
import type { SessionRunner } from '../../src/app/session-operations.js';
import { promptSession, registerSession } from '../../src/app/sessions.js';
import { readInbox, sendMessage } from '../../src/app/events.js';
import type { EventTransport } from '../../src/modules/events/public.js';

function fakeRemote(filename: string, device: string): SessionRunner {
  return { remote: true, device,
    run: async (n, i) => JSON.parse(JSON.stringify(await localSessionRunner(filename).run(n, JSON.parse(JSON.stringify(i))))) };
}

function fixture(t: TestContext) {
  const { dir, filename } = state(t);
  const app = createApp(filename, false);
  try { app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git'); } finally { app.close(); }
  const db = openDatabase(filename);
  try {
    db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
      VALUES ((SELECT id FROM projects WHERE code = 'MP'), 12, 'remote', (SELECT id FROM task_statuses WHERE code = 'new'),
      'projects/one/project/tasks/MP-12-remote', NULL, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run();
  } finally { db.close(); }
  const run1 = join(dir, 'run1'), run2 = join(dir, 'run2'), proc = join(dir, 'proc');
  mkdirSync(run1, { mode: 0o700 });
  mkdirSync(run2, { mode: 0o700 });
  mkdirSync(proc);
  const alive = (pid: number, start = '1') => {
    mkdirSync(join(proc, String(pid)), { recursive: true });
    writeFileSync(join(proc, String(pid), 'stat'), `${pid} (pi) S 1 ${'0 '.repeat(17)}${start} 0 0\n`);
    writeFileSync(join(proc, String(pid), 'cmdline'), 'pi\0');
  };
  const dev1 = fakeRemote(filename, 'dev1'), dev2 = fakeRemote(filename, 'dev2');
  const register = (runner: SessionRunner, runtime: string, pid: number, nativeId: string, socket?: string) => {
    alive(pid);
    return registerSession(runner, { name: 'session_register', agent: 'pi', pid, nativeId, fork: false, envScope: 'MP-12', runtime,
      ...(socket === undefined ? {} : { socket }) }, proc);
  };
  const files = (runtime: string) => {
    const path = join(runtime, 'mypi', 'sessions');
    return existsSync(path) ? readdirSync(path).sort() : [];
  };
  const rows = () => {
    const db = openDatabase(filename, true);
    try {
      return db.prepare('SELECT id, key, agent, native_id AS nativeId, device, active_at AS activeAt FROM sessions ORDER BY id').all() as
        { id: number; key: string; agent: string; nativeId: string; device: string; activeAt: string | null }[];
    } finally { db.close(); }
  };
  const events = () => {
    const db = openDatabase(filename, true);
    try {
      return db.prepare('SELECT id, claimed_by AS claimedBy, delivered_at AS deliveredAt FROM events ORDER BY id').all() as
        { id: number; claimedBy: number | null; deliveredAt: string | null }[];
    } finally { db.close(); }
  };
  return { filename, run1, run2, proc, dev1, dev2, register, files, rows, events };
}

test('register on device 2 writes only device 2\'s registry and saves the row with device dev2', async t => {
  const x = fixture(t);
  assert.deepEqual(await x.register(x.dev2, x.run2, 201, 'p2'), { key: 'MP-12', registered: true });
  assert.deepEqual(x.files(x.run2), ['MP-12~201.json']);
  assert.deepEqual(x.files(x.run1), []);
  assert.deepEqual(x.rows().map(r => [r.key, r.agent, r.nativeId, r.device]), [['MP-12', 'pi', 'p2', 'dev2']]);
});

test('a session registered on device 2 becomes active although device 1\'s session of the key is live', async t => {
  const x = fixture(t);
  await x.register(x.dev1, x.run1, 101, 'p1');
  await x.register(x.dev2, x.run2, 201, 'p2');
  const active = (nativeId: string) => x.rows().find(r => r.nativeId === nativeId)!.activeAt;
  assert.notEqual(active('p1'), null);
  assert.notEqual(active('p2'), null);
  await x.register(x.dev2, x.run2, 202, 'p3');
  assert.equal(active('p3'), null);
  assert.deepEqual(x.files(x.run2), ['MP-12~201.json', 'MP-12~202.json']);
});

test('session prompt on device 1 after device 2 was active prints the pointer with сначала git pull', async t => {
  const x = fixture(t);
  await x.register(x.dev1, x.run1, 101, 'p1');
  await x.register(x.dev2, x.run2, 201, 'p2');
  const line = await promptSession(x.dev1, { name: 'session_prompt', agent: 'pi', nativeId: 'p1', counted: true, runtime: x.run1 }, {}, x.proc);
  assert.match(line, /^\[mypi: с вашего прошлого хода в MP-12 работала сессия pi на dev2: \d+ записей журнала, сначала git pull; подробнее — journal MP-12\]\n$/);
});

test('a sender on device 1 never claims for the active session that is live only on device 2', async t => {
  const x = fixture(t);
  await x.register(x.dev2, x.run2, 201, 'p2', '/s/p2.sock');
  const calls: string[] = [];
  const pi: EventTransport = async (socket, sent) => { calls.push(socket); return sent.map(e => e.id); };
  const sent = await sendMessage(x.dev1, { name: 'message_send', key: 'MP-12', body: { text: 'hi' }, envScope: 'MP', runtime: x.run1 }, { pi }, x.proc);
  assert.deepEqual(sent, { message: 1, delivered: false });
  assert.deepEqual(calls, []);
  assert.deepEqual(x.events(), [{ id: 1, claimedBy: null, deliveredAt: null }]);
});

test('events_claim for a session that is not active returns nothing and leaves data_version unchanged', async t => {
  const x = fixture(t);
  await x.register(x.dev1, x.run1, 101, 'p1', '/s/p1.sock');
  await x.register(x.dev1, x.run1, 102, 'p3', '/s/p3.sock');
  assert.deepEqual(await x.dev1.run('message_create', { from: 'MP', to: 'MP-12', message: 'hi' }), { id: 1 });
  const watcher = openDatabase(x.filename, true);
  try {
    const version = () => watcher.pragma('data_version', { simple: true }) as number;
    const before = version();
    assert.deepEqual(await x.dev1.run('events_claim', { key: 'MP-12', live: [{ agent: 'pi', nativeId: 'p3' }] }),
      { sessionId: null, agent: null, nativeId: null, events: [] });
    assert.deepEqual(await x.dev1.run('events_settle', { sessionId: 1, acked: [], released: [] }), { status: 'ok' });
    assert.equal(version(), before);
  } finally { watcher.close(); }
  assert.deepEqual(x.events(), [{ id: 1, claimedBy: null, deliveredAt: null }]);
});

test('inbox on device 2 records the caller row found through device 2\'s registry', async t => {
  const x = fixture(t);
  await x.register(x.dev2, x.run2, 201, 'p2');
  await x.dev1.run('message_create', { from: 'MP', to: 'MP-12', message: 'hi' });
  const inbox = await readInbox(x.dev2, { name: 'inbox', key: 'MP-12', session: { agent: 'pi', nativeId: 'stale', pid: 201, runtime: x.run2 } }, x.proc);
  assert.deepEqual(inbox.events.map(e => [e.id, e.kind]), [[1, 'message']]);
  const p2 = x.rows().find(r => r.nativeId === 'p2')!.id;
  assert.equal(x.events()[0]!.claimedBy, p2);
  assert.notEqual(x.events()[0]!.deliveredAt, null);
});
