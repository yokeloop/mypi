import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/infrastructure/database/database.js';

const server = fileURLToPath(new URL('../support/event-socket-server.js', import.meta.url));

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-sock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'engine');
  mkdirSync(root);
  cpSync('/work/dist', join(root, 'dist'), { recursive: true });
  symlinkSync('/work/node_modules', join(root, 'node_modules'));
  symlinkSync('/work/integrations', join(root, 'integrations'));
  const entry = join(root, 'dist/src/cli/main.js');
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: '/work/tools:/usr/bin', HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_RUNTIME_DIR: runtime, TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const ok = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 8000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const filename = JSON.parse(ok(['db', 'init'])).database as string;
  ok(['bootstrap']);
  mkdirSync(join(dir, 'clone'));
  ok(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone')]);
  ok(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task 1', '--slug', 'task-1', '--status', 'new']);
  const sock = join(dir, 'MP.sock');
  const listen = async (mode: 'ack' | 'silent' | 'claude', log = join(dir, 'server.log')) => {
    const child = spawn(process.execPath, [server, sock, mode, log], { stdio: ['ignore', 'pipe', 'inherit'] });
    t.after(() => { child.kill(); });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error('Socket server exited: ' + code)));
      child.stdout.setEncoding('utf8');
      let out = '';
      child.stdout.on('data', (chunk: string) => { out += chunk; if (out.includes('ready\n')) resolve(); });
    });
    return child;
  };
  const register = (pid: number, agent: 'pi' | 'claude' = 'pi') => ok(agent === 'claude'
    ? ['session', 'register', '--agent', 'claude', '--pid', String(pid), '--native-id', 'c1', '--socket', sock]
    : ['session', 'register', '--agent', 'pi', '--pid', String(pid), '--native-id', 'p1', '--socket', sock], { MYPI_SCOPE: 'MP' });
  const emit = (message: string) => JSON.parse(ok(['event', 'emit', '--from', 'MP-1', '--message', message])) as { event: number | null; delivered: number[] };
  const delivered = () => {
    const db = openDatabase(filename, true);
    try {
      return (db.prepare('SELECT id, delivered_at AS deliveredAt FROM events ORDER BY id').all() as { id: number; deliveredAt: string | null }[])
        .map(r => [r.id, r.deliveredAt !== null]);
    } finally { db.close(); }
  };
  const received = (log = join(dir, 'server.log')) => readFileSync(log, 'utf8').split('\n').filter(line => line !== '')
    .map(line => (JSON.parse(line) as { id?: number }).id).filter(id => id !== undefined);
  const lines = (log = join(dir, 'server.log')) => readFileSync(log, 'utf8').split('\n').filter(line => line !== '');
  return { dir, sock, listen, register, emit, delivered, received, lines };
}

test('a real Pi socket that acknowledges gets the event and it is marked delivered', async t => {
  const { listen, register, emit, delivered, received, lines } = fixture(t);
  register((await listen('ack')).pid!);
  assert.deepEqual(emit('готово'), { event: 1, delivered: [1] });
  assert.deepEqual(delivered(), [[1, true]]);
  assert.deepEqual(received(), [1]);
  assert.equal(lines().at(-1), '{"end":true}');
});

test('a silent socket leaves the event undelivered after the deadline', async t => {
  const { listen, register, emit, delivered, received } = fixture(t);
  register((await listen('silent')).pid!);
  assert.deepEqual(emit('готово'), { event: 1, delivered: [] });
  assert.deepEqual(delivered(), [[1, false]]);
  assert.deepEqual(received(), [1]);
});

test('a missing socket file delivers nothing and the emit still succeeds', t => {
  const { register, emit, delivered } = fixture(t);
  register(process.pid);
  assert.deepEqual(emit('готово'), { event: 1, delivered: [] });
  assert.deepEqual(delivered(), [[1, false]]);
});

test('two queued events go out with a third one in id order once the socket answers', async t => {
  const { dir, listen, register, emit, delivered, received } = fixture(t);
  const silent = await listen('silent');
  register(silent.pid!);
  assert.deepEqual(emit('a'), { event: 1, delivered: [] });
  assert.deepEqual(emit('b'), { event: 2, delivered: [] });
  const exited = new Promise(resolve => silent.once('exit', resolve));
  silent.kill();
  await exited;
  register((await listen('ack', join(dir, 'ack.log'))).pid!);
  assert.deepEqual(emit('c'), { event: 3, delivered: [1, 2, 3] });
  assert.deepEqual(delivered(), [[1, true], [2, true], [3, true]]);
  assert.deepEqual(received(), [1, 1, 2]);
  assert.deepEqual(received(join(dir, 'ack.log')), [1, 2, 3]);
});

test('a Claude inbox socket gets user lines, a refused or missing socket leaves events queued until the next send', async t => {
  const { dir, sock, listen, register, emit, delivered, lines } = fixture(t);
  const claude = await listen('claude');
  register(claude.pid!, 'claude');
  assert.deepEqual(emit('готово'), { event: 1, delivered: [1] });
  assert.deepEqual(delivered(), [[1, true]]);
  assert.equal(lines().length, 1);
  const line = JSON.parse(lines()[0]!) as { type: string; message: { role: string; content: string } };
  assert.deepEqual(Object.keys(line).sort(), ['message', 'type']);
  assert.equal(line.type, 'user');
  assert.equal(line.message.role, 'user');
  assert.match(line.message.content, /^\[mypi: MP-1 завершил ход в \d\d:\d\d, событие 1\./);
  assert.ok(line.message.content.endsWith('готово'));
  const exited = new Promise(resolve => claude.once('exit', resolve));
  claude.kill();
  await exited;
  register(process.pid, 'claude');
  assert.deepEqual(emit('a'), { event: 2, delivered: [] });
  assert.deepEqual(delivered(), [[1, true], [2, false]]);
  rmSync(sock);
  assert.deepEqual(emit('b'), { event: 3, delivered: [] });
  assert.deepEqual(delivered(), [[1, true], [2, false], [3, false]]);
  const again = await listen('claude', join(dir, 'again.log'));
  register(again.pid!, 'claude');
  assert.deepEqual(emit('c'), { event: 4, delivered: [2, 3, 4] });
  const content = lines(join(dir, 'again.log')).map(l => (JSON.parse(l) as { message: { content: string } }).message.content);
  assert.equal(content.length, 3);
  assert.deepEqual(content.map(c => Number(/событие (\d+)\./.exec(c)![1])), [2, 3, 4]);
  assert.deepEqual(delivered(), [[1, true], [2, true], [3, true], [4, true]]);
});
