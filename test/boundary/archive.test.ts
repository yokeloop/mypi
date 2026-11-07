import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { engineRoot } from '../../src/app/create-app.js';
import { claudeFolderName, piFolderName } from '../../src/modules/archive/public.js';

const jsonl = (records: object[]) => records.map(r => JSON.stringify(r) + '\n').join('');
const at = '2026-11-07T10:00:00.000Z';

test('archive import and status run on isolated state and home', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-archive-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const env = { PATH: '/work/tools', HOME: dir, XDG_STATE_HOME: join(dir, 'state') };
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env, cwd: dir, encoding: 'utf8', timeout: 3000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const cwd = engineRoot().replace(/\/$/, '');
  const claude = join(dir, '.claude', 'projects', claudeFolderName(cwd));
  const pi = join(dir, '.pi', 'agent', 'sessions', piFolderName(cwd));
  mkdirSync(join(claude, 'c1', 'subagents'), { recursive: true });
  mkdirSync(pi, { recursive: true });
  writeFileSync(join(claude, 'c1.jsonl'), jsonl([
    { type: 'user', uuid: 'u1', parentUuid: null, timestamp: at, turnOrigin: 'human', message: { role: 'user', content: 'synthetic question' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: at, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic answer' }] } },
  ]));
  writeFileSync(join(claude, 'c1', 'subagents', 'agent-a.jsonl'), jsonl([
    { type: 'user', uuid: 's1', parentUuid: null, timestamp: at, turnOrigin: 'human', message: { role: 'user', content: 'synthetic subagent' } },
  ]));
  const piFile = (id: string) => jsonl([
    { type: 'session', version: 3, id, timestamp: at, cwd: '/synthetic' },
    { type: 'message', id: id + '-m1', parentId: null, timestamp: at, message: { role: 'user', content: [{ type: 'text', text: 'synthetic question' }] } },
    { type: 'message', id: id + '-m2', parentId: id + '-m1', timestamp: at, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'synthetic answer' }] } },
  ]);
  writeFileSync(join(pi, '2026-11-07T10-00-00-000Z_p1.jsonl'), piFile('p1'));
  const archive = join(dir, 'state', 'mypi', 'archive.sqlite3');

  const empty = run('archive', 'status');
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(JSON.parse(empty.stdout).exists, false);
  assert.equal(existsSync(join(dir, 'state')), false);
  const early = run('archive', 'import');
  assert.equal(early.status, 1);
  assert.equal(JSON.parse(early.stderr).status, 'error');
  assert.equal(existsSync(archive), false);
  const unread = run('archive', 'search', 'x');
  assert.equal(unread.status, 1);
  assert.match(JSON.parse(unread.stderr).message, /mypi archive import/);
  assert.equal(existsSync(archive), false);

  assert.equal(run('db', 'init').status, 0);
  const first = run('archive', 'import');
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual([JSON.parse(first.stdout).files, JSON.parse(first.stdout).inserted], [2, 4]);
  assert.equal(statSync(archive).mode & 0o777, 0o600);
  assert.equal(JSON.parse(run('archive', 'import').stdout).inserted, 0);
  const found = run('archive', 'search', 'synthetic');
  assert.equal(found.status, 0, found.stderr);
  const { hits } = JSON.parse(found.stdout);
  assert.ok(hits.length >= 1);
  assert.equal(JSON.parse(run('archive', 'search').stdout).sessions.length, 2);
  const window = run('archive', 'show', String(hits[0].id));
  assert.equal(window.status, 0, window.stderr);
  assert.ok(JSON.parse(window.stdout).messages.length >= 1);

  const status = run('archive', 'status');
  assert.equal(status.status, 0, status.stderr);
  const counts = JSON.parse(status.stdout);
  assert.deepEqual([counts.sessions, counts.messages, counts.exists], [{ claude: 1, pi: 1 }, { claude: 2, pi: 2 }, true]);
  assert.ok(counts.bytes > 0);

  const other = join(dir, 'other');
  mkdirSync(other);
  writeFileSync(join(other, '2026-11-07T11-00-00-000Z_p2.jsonl'), piFile('p2'));
  const extra = run('archive', 'import', '--dir', other, '--agent', 'pi');
  assert.equal(extra.status, 0, extra.stderr);
  assert.equal(JSON.parse(extra.stdout).dirs.length, 1);
  assert.equal(JSON.parse(run('archive', 'status').stdout).sessions.pi, 2);
  assert.equal(run('archive', 'import', '--dir', other).status, 1);

  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /mypi archive import/);
  assert.match(help.stdout, /mypi archive search/);
});

test('archive capture reads Claude hook input from stdin and never exits 2', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-archive-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const env = { PATH: '/work/tools', HOME: dir, XDG_STATE_HOME: join(dir, 'state') };
  const run = (input: string, ...args: string[]) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env, cwd: dir, encoding: 'utf8', timeout: 3000, input });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return result;
  };
  const c1 = join(dir, 'c1.jsonl');
  writeFileSync(c1, jsonl([
    { type: 'user', uuid: 'u1', parentUuid: null, timestamp: at, turnOrigin: 'human', message: { role: 'user', content: 'synthetic question' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: at, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic answer' }] } },
  ]));
  const stop = (path?: string) => JSON.stringify({ session_id: 'c1', ...(path === undefined ? {} : { transcript_path: path }), cwd: dir,
    permission_mode: 'default', hook_event_name: 'Stop', stop_hook_active: false });
  const end = (path: string) => JSON.stringify({ session_id: 'c1', transcript_path: path, cwd: dir, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  const hook = (input: string) => run(input, 'archive', 'capture', '--agent', 'claude', '--hook');
  const archive = join(dir, 'state', 'mypi', 'archive.sqlite3');

  assert.equal(hook(stop(c1)).status, 1);
  assert.equal(existsSync(join(dir, 'state')), false);
  assert.equal(run('', 'db', 'init').status, 0);
  const first = hook(stop(c1));
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual([JSON.parse(first.stdout).captured, JSON.parse(first.stdout).inserted], [true, 2]);
  assert.equal(JSON.parse(hook(stop(c1)).stdout).inserted, 0);
  appendFileSync(c1, jsonl([
    { type: 'assistant', uuid: 'a2', parentUuid: 'a1', timestamp: at, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic late answer' }] } },
  ]));
  const late = hook(end(c1));
  assert.equal(late.status, 0, late.stderr);
  assert.equal(JSON.parse(late.stdout).inserted, 1);
  const none = hook(stop());
  assert.equal(none.status, 0, none.stderr);
  assert.equal(JSON.parse(none.stdout).captured, false);
  assert.equal(hook('{').status, 1);

  const pi = join(dir, '2026-11-07T10-00-00-000Z_p1.jsonl');
  writeFileSync(pi, jsonl([
    { type: 'session', version: 3, id: 'p1', timestamp: at, cwd: '/synthetic' },
    { type: 'message', id: 'm1', parentId: null, timestamp: at, message: { role: 'user', content: [{ type: 'text', text: 'synthetic question' }] } },
    { type: 'message', id: 'm2', parentId: 'm1', timestamp: at, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'synthetic answer' }] } },
  ]));
  const piRun = run('', 'archive', 'capture', '--agent', 'pi', '--file', pi);
  assert.equal(piRun.status, 0, piRun.stderr);
  assert.equal(JSON.parse(piRun.stdout).captured, true);

  for (const suffix of ['-wal', '-shm']) rmSync(archive + suffix, { force: true });
  writeFileSync(archive, 'not a database');
  const broken = hook(stop(c1));
  assert.equal(broken.status, 1);
  assert.equal(JSON.parse(broken.stderr).status, 'error');
});
