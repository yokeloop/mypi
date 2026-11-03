import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('real mypi serve on loopback: bearer auth, read paging with a cursor, write permission, changeId and SSE after a write, access log without secrets', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-http-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = '/work/dist/src/cli/main.js';
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: '/work/tools:/usr/bin', HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_RUNTIME_DIR: runtime, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig') };
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    return result;
  };
  for (const args of [['db', 'init'], ['project', 'add', 'fx/one', '--code', 'FX', '--repository', 'local']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
  }
  const empty = run(['serve', '--port', '0'], { XDG_CONFIG_HOME: join(dir, 'empty-config') });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /No API tokens/);
  const token = (name: string, permission: string) => {
    const result = run(['token', 'create', name, '--permission', permission]);
    assert.equal(result.status, 0, result.stderr);
    return (JSON.parse(result.stdout) as { token: string }).token;
  };
  const reader = token('reader', 'read'), writer = token('writer', 'write');

  const child = spawn(process.execPath, [entry, 'serve', '--port', '0'], { env, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  const url = await new Promise<string>((resolve, reject) => {
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      const line = stdout.split('\n')[0];
      if (stdout.includes('\n')) resolve((JSON.parse(line!) as { url: string }).url);
    });
    child.once('exit', code => reject(new Error('serve exited ' + code + ': ' + stderr)));
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const auth = (value: string) => ({ authorization: 'Bearer ' + value });
  const get = async (path: string, value = reader) => {
    const response = await fetch(url + path, { headers: auth(value) });
    return { status: response.status, body: await response.json() as { data: never; error: { code: string } } };
  };
  const post = async (path: string, value: string, body: unknown) => {
    const response = await fetch(url + path, { method: 'POST', headers: { ...auth(value), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { data: { id: number }; error: { code: string } } };
  };

  assert.equal((await fetch(url + '/v1/info')).status, 401);
  assert.equal((await fetch(url + '/v1/info', { headers: auth('nope') })).status, 401);
  const info = await get('/v1/info');
  assert.equal(info.status, 200);
  const version = (JSON.parse(readFileSync('/work/package.json', 'utf8')) as { version: string }).version;
  const { schemaVersion, version: served, changeId: c0 } = info.body.data as { schemaVersion: number; version: string; changeId: number };
  assert.deepEqual([schemaVersion, served], [12, version]);

  const controller = new AbortController();
  const sse = await fetch(url + '/v1/changes', { headers: auth(reader), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
  assert.equal(sse.status, 200);
  const stream = sse.body!.getReader(), decoder = new TextDecoder();
  let buffer = '';
  const nextChange = async () => {
    for (;;) {
      const match = /data: (\{[^\n]*\})\n\n/.exec(buffer);
      if (match) { buffer = buffer.slice(match.index + match[0].length); return (JSON.parse(match[1]!) as { changeId: number }).changeId; }
      const { value, done } = await stream.read();
      if (done) throw new Error('SSE ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  assert.equal(await nextChange(), c0);

  const refused = await post('/v1/messages', reader, { to: 'FX', text: 'один' });
  assert.deepEqual([refused.status, refused.body.error.code], [403, 'forbidden']);
  for (const text of ['один', 'два']) {
    const sent = await post('/v1/messages', writer, { to: 'FX', text });
    assert.equal(sent.status, 201);
    assert.equal(typeof sent.body.data.id, 'number');
  }
  const started = Date.now();
  assert.ok(await nextChange() > c0);
  assert.ok(Date.now() - started < 5000);
  assert.ok((await get('/v1/info')).body.data['changeId'] > c0);

  const first = await get('/v1/events?to=FX&limit=1');
  const { items, next } = first.body.data as { items: { text: string; from: string }[]; next: string };
  assert.deepEqual(items.map(e => [e.text, e.from]), [['два', 'global']]);
  assert.equal(typeof next, 'string');
  const second = (await get('/v1/events?to=FX&limit=1&cursor=' + next)).body.data as { items: { text: string }[]; next: null };
  assert.deepEqual([second.items.map(e => e.text), second.next], [['один'], null]);
  controller.abort();
  await stream.cancel().catch(() => {});

  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.match(stderr, / \/v1\/messages 403 reader/);
  assert.match(stderr, / \/v1\/messages 201 writer/);
  for (const secret of [reader, writer, 'один', 'два']) assert.equal(stderr.includes(secret), false, secret);
});
