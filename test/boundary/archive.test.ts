import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  assert.equal(run('db', 'init').status, 0);
  const first = run('archive', 'import');
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual([JSON.parse(first.stdout).files, JSON.parse(first.stdout).inserted], [2, 4]);
  assert.equal(statSync(archive).mode & 0o777, 0o600);
  assert.equal(JSON.parse(run('archive', 'import').stdout).inserted, 0);

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
});
