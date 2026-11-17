import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';

test('writer reservation blocks a second source callback before number allocation completes', async t => {
  const { filename } = state(t);
  const setup = createApp(filename, false); setup.projects.add('one/project', 'MP'); setup.close();
  const module = fileURLToPath(new URL('../../src/app/create-app.js', import.meta.url));
  const program = `import {createApp} from ${JSON.stringify(module)};
const app=createApp(process.argv[1],false);
app.tasks.create({projectId:1,title:'Held',status:'new',slug:'held'},()=>{
  process.send('inside-source-before-insert');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, filename],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve()); child.once('error', reject);
    child.once('exit', code => reject(new Error('Early writer exit: ' + code)));
  });
  const second = createApp(filename, false);
  try {
    let sourceCalled = false;
    assert.throws(() => second.tasks.create({projectId:1,title:'Other',status:'new',slug:'other'},
      () => { sourceCalled = true; }), /locked/);
    assert.equal(sourceCalled, false, 'reservation must precede source side effects');
    assert.equal(second.tasks.list().length, 0);
  } finally {
    second.close();
    const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
  }
});

test('two simultaneous claims of one key give each row to one session', async t => {
  const { filename } = state(t);
  const setup = createApp(filename, false);
  try {
    setup.projects.add('one/project', 'MP');
    setup.sessions(undefined).activate({ key: 'MP', agent: 'claude', nativeId: 'a' });
    setup.sessions(undefined).activate({ key: 'MP', agent: 'claude', nativeId: 'b' });
  } finally { setup.close(); }
  const db = openDatabase(filename);
  let A: number, B: number;
  try {
    A = db.prepare('SELECT id FROM sessions WHERE native_id = ?').pluck().get('a') as number;
    B = db.prepare('SELECT id FROM sessions WHERE native_id = ?').pluck().get('b') as number;
    const insert = db.prepare("INSERT INTO events(from_key, to_key, kind, message, created_at) VALUES ('MP-1', 'MP', 'turn_end', 'done', '2026-11-17T00:00:00.000Z')");
    for (let i = 0; i < 3; i++) insert.run();
  } finally { db.close(); }
  const claims = () => {
    const db = openDatabase(filename, true);
    try { return db.prepare('SELECT id, claimed_by AS claimedBy FROM events ORDER BY id').all() as { id: number; claimedBy: number | null }[]; } finally { db.close(); }
  };
  const module = fileURLToPath(new URL('../../src/app/create-app.js', import.meta.url));
  const program = `import {createApp} from ${JSON.stringify(module)};
const app=createApp(process.argv[1],false);
app.serialize(()=>{
  const got=app.events.claim('MP',Number(process.argv[2]));
  process.send(got.map(e=>e.id));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);
});
app.close();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, filename, String(A)],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const first = await new Promise<number[]>((resolve, reject) => {
    child.once('message', message => resolve(message as number[])); child.once('error', reject);
    child.once('exit', code => reject(new Error('Early claimer exit: ' + code)));
  });
  const second = createApp(filename, false);
  try {
    assert.deepEqual(first, [1, 2, 3]);
    assert.deepEqual(second.serialize(() => second.events.claim('MP', B)).map(e => e.id), []);
    assert.deepEqual(claims(), [{ id: 1, claimedBy: A }, { id: 2, claimedBy: A }, { id: 3, claimedBy: A }]);
    const db = openDatabase(filename);
    try { db.prepare("INSERT INTO events(from_key, to_key, kind, message, created_at) VALUES ('MP-1', 'MP', 'turn_end', 'more', '2026-11-17T00:00:01.000Z')").run(); } finally { db.close(); }
    assert.deepEqual(second.serialize(() => second.events.claim('MP', B)).map(e => e.id), [4]);
    assert.deepEqual(claims(), [{ id: 1, claimedBy: A }, { id: 2, claimedBy: A }, { id: 3, claimedBy: A }, { id: 4, claimedBy: B }]);
  } finally {
    second.close();
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
  }
});
