import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('real Node launcher persists projects across independent processes without Python or context writes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const env = { PATH: '/work/tools', HOME: dir, XDG_STATE_HOME: join(dir, 'state') };
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env, cwd: dir, encoding: 'utf8', timeout: 3000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  assert.equal(run('project', 'list').status, 1);
  assert.equal(existsSync(join(dir, 'state')), false);
  const init = run('db', 'init');
  assert.equal(init.status, 0, init.stderr);
  const filename = JSON.parse(init.stdout).database as string;
  const add = run('project', 'add', 'one/project', '--code', 'MP');
  assert.equal(add.status, 0, add.stderr);
  const project = JSON.parse(add.stdout).project;
  assert.equal(project.code, 'MP');
  const before = readFileSync(filename);
  const list = run('project', 'list');
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).projects, [project]);
  assert.deepEqual(readFileSync(filename), before);
  const duplicate = run('project', 'add', 'two/project', '--code', 'MP');
  assert.equal(duplicate.status, 1);
  assert.equal(JSON.parse(duplicate.stderr).status, 'error');
  assert.equal(duplicate.stdout, '');
  assert.equal(existsSync(join(dir, 'home')), false);
});

test('real CLI registers a hook session, resolves the warmup by it and keeps registry files private', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: '/work/tools', HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_RUNTIME_DIR: runtime };
  const run = (args: string[], extra: Record<string, string> = {}, input?: string, base: Record<string, string> = env) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...base, ...extra }, cwd: dir, encoding: 'utf8', timeout: 3000,
      ...(input === undefined ? {} : { input }) });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const ok = (args: string[], extra: Record<string, string> = {}, input?: string) => {
    const result = run(args, extra, input);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const pid = String(process.pid);
  ok(['db', 'init']);
  mkdirSync(join(dir, 'clone'));
  ok(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone')]);
  assert.equal(ok(['session', 'register', '--agent', 'claude', '--hook', '--pid', pid], { MYPI_SCOPE: 'MP' },
    '{"session_id":"c1","source":"startup","session_title":"t"}'), '{"key":"MP","registered":true,"displaced":null}\n');
  assert.equal(statSync(join(runtime, 'mypi', 'sessions', 'MP.json')).mode & 0o777, 0o600);
  assert.equal(statSync(join(runtime, 'mypi')).mode & 0o777, 0o700);
  assert.equal(statSync(join(runtime, 'mypi', 'sessions')).mode & 0o777, 0o700);
  assert.ok(ok(['warmup'], { CLAUDE_CODE_SESSION_ID: 'c1' }).startsWith('# mypi warmup: MP (one/project)'));
  assert.deepEqual(JSON.parse(ok(['sessions'])).tree.children[0],
    { key: 'MP', session: { agent: 'claude', nativeId: 'c1', state: 'live' }, children: [] });
  assert.equal(ok(['session', 'unregister', '--pid', pid]), '{"removed":["MP"]}\n');
  assert.equal(JSON.parse(ok(['sessions'])).tree.children[0].session.state, 'closed');
  assert.equal(ok(['session', 'forget', 'MP']), '{"forgotten":"MP","live":false}\n');
  const { XDG_RUNTIME_DIR: _, ...bare } = env;
  const missing = run(['session', 'register', '--agent', 'pi', '--pid', pid, '--native-id', 'p1'], {}, undefined, bare);
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stderr).message, /XDG_RUNTIME_DIR must be an absolute path/);
});
