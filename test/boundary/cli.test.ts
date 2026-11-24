import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { resolveStatePath } from '../../src/app/create-app.js';
import { run as runInProcess } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';
import { fromWork, toolsPath, systemPath } from '../support/work.js';

const inProcess = (env: Record<string, string>, root?: string) => (args: string[], extra: Record<string, string> = {}) =>
  runInProcess(parseCommand(args), resolveStatePath(env, env['HOME']!), root, { ...env, ...extra });

test('real Node launcher persists projects across independent processes without Python or context writes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const env = { PATH: toolsPath, HOME: dir, XDG_STATE_HOME: join(dir, 'state') };
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
  const add = run('project', 'add', 'one/project', '--code', 'MP', '--repository', 'file:///nonexistent/one/project.git');
  assert.equal(add.status, 0, add.stderr);
  const project = JSON.parse(add.stdout).project;
  assert.equal(project.code, 'MP');
  const none = run('project', 'add', 'one/none', '--code', 'NO');
  assert.equal(none.status, 1);
  assert.equal(none.stdout, '');
  assert.deepEqual(JSON.parse(none.stderr), { status: 'error', message: 'project add requires org/project, --code and --repository <git-url>' });
  const local = run('project', 'add', 'one/local', '--code', 'LC', '--repository', 'local');
  assert.equal(local.status, 1);
  assert.equal(local.stdout, '');
  assert.match(JSON.parse(local.stderr).message, /^Invalid repository "local": local is no longer accepted; give the Git remote URL;/);
  const before = readFileSync(filename);
  const list = run('project', 'list');
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).projects, [project]);
  assert.deepEqual(readFileSync(filename), before);
  const duplicate = run('project', 'add', 'two/project', '--code', 'MP', '--repository', 'file:///nonexistent/two/project.git');
  assert.equal(duplicate.status, 1);
  assert.equal(JSON.parse(duplicate.stderr).status, 'error');
  assert.equal(duplicate.stdout, '');
  const stale = run('project', 'remove', 'one/project', '--expected-code', 'XX');
  assert.equal(stale.status, 1);
  assert.deepEqual(JSON.parse(stale.stderr), { status: 'error', message: 'Stale project code' });
  assert.equal(stale.stdout, '');
  const removed = run('project', 'remove', 'one/project', '--expected-code', 'MP');
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(JSON.parse(removed.stdout).removed, { project });
  assert(Object.hasOwn(JSON.parse(removed.stdout), 'homeFolder'));
  const org = run('org', 'remove', 'one');
  assert.equal(org.status, 0, org.stderr);
  assert.deepEqual(JSON.parse(org.stdout).removed, { organization: 'one' });
  assert.deepEqual(JSON.parse(run('project', 'list').stdout).projects, []);
  assert.equal(existsSync(join(dir, 'home')), false);
});

test('real CLI registers a hook session, resolves the warmup by it and keeps registry files private', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: toolsPath, HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_RUNTIME_DIR: runtime };
  const setup = inProcess(env);
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
  await setup(['db', 'init']);
  mkdirSync(join(dir, 'clone'));
  await setup(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone'), '--repository', 'file:///nonexistent/one/project.git']);
  assert.equal(ok(['session', 'register', '--agent', 'claude', '--hook', '--pid', pid], { MYPI_SCOPE: 'MP' },
    '{"session_id":"c1","source":"startup","session_title":"t"}'), '{"key":"MP","registered":true}\n');
  assert.equal(statSync(join(runtime, 'mypi', 'sessions', 'MP~' + pid + '.json')).mode & 0o777, 0o600);
  assert.equal(statSync(join(runtime, 'mypi')).mode & 0o777, 0o700);
  assert.equal(statSync(join(runtime, 'mypi', 'sessions')).mode & 0o777, 0o700);
  assert.ok(ok(['warmup'], { CLAUDE_CODE_SESSION_ID: 'c1' }).startsWith('# mypi warmup: MP (one/project)'));
  const node = JSON.parse(ok(['sessions'])).tree.children[0].children[0];
  assert.match(node.sessions[0].activeAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(node, { key: 'MP', session: { agent: 'claude', nativeId: 'c1', state: 'live' },
    sessions: [{ agent: 'claude', nativeId: 'c1', device: hostname(), activeAt: node.sessions[0].activeAt, state: 'live' }], children: [] });
  assert.equal(ok(['session', 'unregister', '--pid', pid]), '{"removed":["MP"]}\n');
  assert.equal(JSON.parse(ok(['sessions'])).tree.children[0].children[0].session.state, 'closed');
  assert.equal(ok(['session', 'forget', 'MP']), '{"forgotten":"MP","live":false}\n');
  const { XDG_RUNTIME_DIR: _, ...bare } = env;
  if (process.platform === 'darwin') {
    mkdirSync(join(dir, 'tmp'), { mode: 0o700 });
    const fallback = run(['session', 'register', '--agent', 'pi', '--pid', pid, '--native-id', 'p1'], {}, undefined, { ...bare, TMPDIR: join(dir, 'tmp') });
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.equal(JSON.parse(fallback.stdout).registered, true);
    assert.notDeepEqual(readdirSync(join(dir, 'tmp', 'mypi', 'sessions')), []);
  } else {
    const missing = run(['session', 'register', '--agent', 'pi', '--pid', pid, '--native-id', 'p1'], {}, undefined, bare);
    assert.equal(missing.status, 1);
    assert.match(JSON.parse(missing.stderr).message, /XDG_RUNTIME_DIR must be an absolute path/);
  }
});

test('real CLI session prompt prints one line after a switch, nothing on a repeat, and ignores a mypi frame', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sleeper = spawn('/bin/sleep', ['30']);
  t.after(() => { sleeper.kill(); });
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: toolsPath, HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_RUNTIME_DIR: runtime };
  const setup = inProcess(env);
  const ok = (args: string[], extra: Record<string, string> = {}, input?: string) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 3000,
      ...(input === undefined ? {} : { input }) });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const active = () => JSON.parse(ok(['sessions'])).tree.children[0].children[0].session.nativeId;
  await setup(['db', 'init']);
  mkdirSync(join(dir, 'clone'));
  await setup(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone'), '--repository', 'file:///nonexistent/one/project.git']);
  ok(['session', 'register', '--agent', 'claude', '--hook', '--pid', String(process.pid)], { MYPI_SCOPE: 'MP' }, '{"session_id":"c1","source":"startup"}');
  ok(['session', 'register', '--agent', 'pi', '--pid', String(sleeper.pid), '--native-id', 'p1'], { MYPI_SCOPE: 'MP' });
  assert.equal(active(), 'c1');
  assert.equal(ok(['session', 'prompt', '--agent', 'pi', '--native-id', 'p1']), '');
  assert.equal(active(), 'p1');
  const hook = (prompt: string) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'c1', prompt });
  assert.equal(ok(['session', 'prompt', '--agent', 'claude', '--hook'], {},
    hook('[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение родительской сессии]\ngo')), '');
  assert.equal(active(), 'p1');
  assert.equal(ok(['session', 'prompt', '--agent', 'claude', '--hook'], {}, hook('привет')),
    '[mypi: с вашего прошлого хода в MP работала сессия pi на ' + hostname() + ': 0 записей журнала; подробнее — journal MP]\n');
  assert.equal(active(), 'c1');
  assert.equal(ok(['session', 'prompt', '--agent', 'claude', '--hook'], {}, hook('ещё')), '');
});

test('real CLI pointer counts the task journal and the commits of the task worktree', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sleeper = spawn('/bin/sleep', ['30']);
  t.after(() => { sleeper.kill(); });
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: systemPath, HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_RUNTIME_DIR: runtime,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const setup = inProcess(env);
  const ok = (args: string[], extra: Record<string, string> = {}, input?: string) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 3000,
      ...(input === undefined ? {} : { input }) });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const git = (date: string, ...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
      { encoding: 'utf8', timeout: 5000, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
    assert.equal(result.status, 0, result.stderr);
  };
  const wt = join(dir, 'wt');
  git('2025-12-31T00:00:00Z', 'init', '--quiet', '--initial-branch=main', wt);
  git('2025-12-31T00:00:00Z', '-C', wt, 'commit', '--quiet', '--allow-empty', '-m', 'seed');
  const filename = (await setup(['db', 'init']) as { database: string }).database;
  mkdirSync(join(dir, 'clone'));
  await setup(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone'), '--repository', 'file:///nonexistent/one/project.git']);
  const write = (sql: string, ...params: string[]) => {
    const db = openDatabase(filename);
    try { db.prepare(sql).run(...params); } finally { db.close(); }
  };
  write(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
    VALUES ((SELECT id FROM projects WHERE code = 'MP'), 1, 'task', (SELECT id FROM task_statuses WHERE code = 'new'),
    'projects/one/project/tasks/MP-1-task', ?, '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z')`, wt);
  ok(['session', 'register', '--agent', 'claude', '--hook', '--pid', String(process.pid)], { MYPI_SCOPE: 'MP-1' }, '{"session_id":"c1","source":"startup"}');
  ok(['session', 'register', '--agent', 'pi', '--pid', String(sleeper.pid), '--native-id', 'p1'], { MYPI_SCOPE: 'MP-1' });
  assert.equal(ok(['session', 'prompt', '--agent', 'pi', '--native-id', 'p1']), '');
  write("UPDATE sessions SET active_at = '2026-01-01T00:00:00.000Z' WHERE native_id = 'c1'");
  write("INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text) VALUES ('2026-01-02T00:00:00.000Z', 'task', 'MP-1', 'note', 'x')");
  git('2026-01-02T00:00:00Z', '-C', wt, 'commit', '--quiet', '--allow-empty', '-m', 'work');
  const hook = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'c1', prompt: 'привет' });
  assert.equal(ok(['session', 'prompt', '--agent', 'claude', '--hook'], {}, hook),
    '[mypi: с вашего прошлого хода в MP-1 работала сессия pi на ' + hostname() + ': 1 записей журнала, 1 коммитов в ветке; подробнее — journal MP-1]\n');
});

test('real CLI session prompt hook stays silent and exits 0 when the pointer fails', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sleeper = spawn('/bin/sleep', ['30']);
  t.after(() => { sleeper.kill(); });
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: toolsPath, HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_RUNTIME_DIR: runtime };
  const setup = inProcess(env);
  const ok = (args: string[], extra: Record<string, string> = {}, input?: string) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 3000,
      ...(input === undefined ? {} : { input }) });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const active = () => JSON.parse(ok(['sessions'])).tree.children[0].children[0].session.nativeId;
  const filename = (await setup(['db', 'init']) as { database: string }).database;
  mkdirSync(join(dir, 'clone'));
  await setup(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone'), '--repository', 'file:///nonexistent/one/project.git']);
  ok(['session', 'register', '--agent', 'claude', '--hook', '--pid', String(process.pid)], { MYPI_SCOPE: 'MP' }, '{"session_id":"c1","source":"startup"}');
  ok(['session', 'register', '--agent', 'pi', '--pid', String(sleeper.pid), '--native-id', 'p1'], { MYPI_SCOPE: 'MP' });
  assert.equal(ok(['session', 'prompt', '--agent', 'pi', '--native-id', 'p1']), '');
  assert.equal(active(), 'p1');
  const db = openDatabase(filename);
  try { db.exec('DROP TABLE knowledge_journal'); } finally { db.close(); }
  const hook = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'c1', prompt: 'привет' });
  assert.equal(ok(['session', 'prompt', '--agent', 'claude', '--hook'], {}, hook), '');
  assert.equal(active(), 'c1');
});

test('real CLI turns parent-started Stop and Notification hook input into one event each and inbox delivers them once', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'engine');
  mkdirSync(root);
  cpSync(fromWork('dist'), join(root, 'dist'), { recursive: true });
  symlinkSync(fromWork('node_modules'), join(root, 'node_modules'));
  symlinkSync(fromWork('integrations'), join(root, 'integrations'));
  const entry = join(root, 'dist/src/cli/main.js');
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: systemPath, HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_RUNTIME_DIR: runtime, TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const setup = inProcess(env, join(root, 'home'));
  const ok = (args: string[], extra: Record<string, string> = {}, input?: string) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 4000,
      ...(input === undefined ? {} : { input }) });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const pid = String(process.pid);
  await setup(['db', 'init']);
  await setup(['bootstrap']);
  mkdirSync(join(dir, 'clone'));
  await setup(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone'), '--repository', 'file:///nonexistent/one/project.git']);
  assert.equal((await setup(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task', '--slug', 'task', '--status', 'new']) as { key: string }).key, 'MP-1');
  for (let i = 2; i <= 12; i++) await setup(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task ' + i, '--slug', 'task-' + i, '--status', 'new']);
  assert.equal(ok(['session', 'register', '--agent', 'claude', '--hook', '--pid', pid], { MYPI_SCOPE: 'MP-12' },
    '{"session_id":"c1","source":"startup"}'), '{"key":"MP-12","registered":true}\n');
  writeFileSync(join(dir, 't.jsonl'), JSON.stringify({ type: 'user', turnOrigin: 'peer', message: { role: 'user',
    content: 'Another Claude session sent a message:\n[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение родительской сессии]\ngo' } }) + '\n');
  writeFileSync(join(dir, 'human.jsonl'), JSON.stringify({ type: 'user', turnOrigin: 'human', message: { role: 'user', content: 'сделай' } }) + '\n');
  const stop = { session_id: 'c1', transcript_path: join(dir, 't.jsonl'), cwd: dir, hook_event_name: 'Stop', stop_hook_active: false,
    last_assistant_message: 'готово' };
  assert.equal(ok(['turn', 'end', '--pid', pid], {}, JSON.stringify({ ...stop, transcript_path: join(dir, 'human.jsonl') })), '');
  assert.equal(ok(['turn', 'end', '--pid', pid], {}, JSON.stringify(stop)), '');
  assert.equal(ok(['turn', 'end', '--pid', pid], {}, JSON.stringify({ ...stop, stop_hook_active: true, last_assistant_message: 'итог' })), '');
  assert.deepEqual((JSON.parse(ok(['event', 'list', '--from', 'MP-12'])).items as { id: number; kind: string; message: string }[])
    .map(e => [e.id, e.kind, e.message]).sort(), [[1, 'turn_end', 'готово'], [2, 'turn_end', 'итог']]);
  writeFileSync(join(dir, 'scratch.jsonl'), [{ type: 'user', turnOrigin: 'human', message: { role: 'user', content: 'сделай' } },
    { type: 'assistant', cwd: dir, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write',
      input: { file_path: join(dir, 'scratch/notes.md'), content: '# Notes\n' } }] } }].map(entry => JSON.stringify(entry) + '\n').join(''));
  const block = JSON.parse(ok(['turn', 'end', '--pid', pid], {}, JSON.stringify({ ...stop, transcript_path: join(dir, 'scratch.jsonl'),
    scratchpad_dir: join(dir, 'scratch') }))) as { decision: string; reason: string };
  assert.equal(block.decision, 'block');
  assert.ok(block.reason.includes(join(dir, 'scratch/notes.md')), block.reason);
  const piNotes = join(dir, 'pi-notes.md');
  writeFileSync(join(dir, 'pi.jsonl'), [{ type: 'session', version: 3, id: 's1', timestamp: '2026-11-07T10:00:00.000Z', cwd: dir },
    { type: 'message', id: 'e1', parentId: null, timestamp: '2026-11-07T10:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'сделай' }] } },
    { type: 'message', id: 'e2', parentId: 'e1', timestamp: '2026-11-07T10:00:02.000Z', message: { role: 'assistant', content: [{ type: 'toolCall', id: 't1',
      name: 'write', arguments: { path: piNotes, content: '# Notes\n' } }] } }].map(entry => JSON.stringify(entry) + '\n').join(''));
  const check = ['turn', 'check', '--agent', 'pi', '--file', join(dir, 'pi.jsonl'), '--key', 'global'];
  const found = JSON.parse(ok(check, { TMPDIR: tmpdir() })) as { reason: string };
  assert.equal(typeof found.reason, 'string');
  assert.ok(found.reason.includes(piNotes), found.reason);
  assert.equal(ok([...check, '--since', 'e2'], { TMPDIR: tmpdir() }), '{}\n');
  const claude = spawnSync(process.execPath, [entry, 'turn', 'check', '--agent', 'claude', '--file', join(dir, 'pi.jsonl'), '--key', 'global'],
    { env, cwd: dir, encoding: 'utf8', timeout: 4000 });
  assert.equal(claude.status, 1);
  assert.match(claude.stderr, /--agent must be pi/);
  const notification = { session_id: 'c1', transcript_path: join(dir, 't.jsonl'), cwd: dir, hook_event_name: 'Notification',
    message: 'Claude needs your permission', notification_type: 'permission_prompt' };
  assert.equal(ok(['event', 'emit', '--waiting', '--hook', '--pid', pid], {},
    JSON.stringify({ ...notification, message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })), '{"event":null,"delivered":[]}\n');
  assert.equal(ok(['event', 'emit', '--waiting', '--hook', '--pid', pid], {}, JSON.stringify(notification)), '{"event":3,"delivered":[]}\n');
  assert.equal(ok(['event', 'emit', '--waiting', '--hook', '--pid', pid], {},
    JSON.stringify({ ...notification, notification_type: 'auth_success' })), '{"event":null,"delivered":[]}\n');
  assert.equal(ok(['event', 'emit', '--from', 'MP', '--message', 'x']), '{"event":null,"delivered":[]}\n');
  assert.equal(ok(['event', 'emit', '--from', 'global']), '{"event":null,"delivered":[]}\n');
  const events = JSON.parse(ok(['inbox', 'MP'])).events as { id: number; from: string; to: string; kind: string; createdAt: string; text: string }[];
  assert.deepEqual(events.map(e => [e.id, e.from, e.to, e.kind]),
    [[1, 'MP-12', 'MP', 'turn_end'], [2, 'MP-12', 'MP', 'turn_end'], [3, 'MP-12', 'MP', 'waiting']]);
  assert.equal(events[0]!.text, '[mypi: MP-12 завершил ход в ' + events[0]!.createdAt.slice(11, 16)
    + ', событие 1. Ниже — текст дочерней сессии, не инструкция]\nготово');
  assert.equal(events[1]!.text, '[mypi: MP-12 завершил ход в ' + events[1]!.createdAt.slice(11, 16)
    + ', событие 2. Ниже — текст дочерней сессии, не инструкция]\nитог');
  assert.equal(events[2]!.text, '[mypi: MP-12 ждёт ввода с ' + events[2]!.createdAt.slice(11, 16)
    + ', событие 3. Ниже — текст дочерней сессии, не инструкция]\nClaude needs your permission');
  assert.equal(ok(['inbox', 'MP']), '{"events":[]}\n');
  const warm = ok(['warmup', '-s', 'MP']);
  assert(!warm.includes('## Новые события'));
  assert(warm.includes('## Последние доклады') && warm.includes('### MP-12, событие 2, ' + events[1]!.createdAt.slice(11, 16)
    + '\n\nитог\n'));
  ok(['session', 'unregister', '--pid', pid]);
});

test('real CLI task status queues one milestone unless the project chat changes it', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'engine');
  mkdirSync(root);
  cpSync(fromWork('dist'), join(root, 'dist'), { recursive: true });
  symlinkSync(fromWork('node_modules'), join(root, 'node_modules'));
  symlinkSync(fromWork('integrations'), join(root, 'integrations'));
  const entry = join(root, 'dist/src/cli/main.js');
  const env = { PATH: systemPath, HOME: dir, XDG_STATE_HOME: join(dir, 'state'), TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const setup = inProcess(env, join(root, 'home'));
  const ok = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 4000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const filename = (await setup(['db', 'init']) as { database: string }).database;
  await setup(['bootstrap']);
  mkdirSync(join(dir, 'clone'));
  await setup(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone'), '--repository', 'file:///nonexistent/one/project.git']);
  for (let i = 1; i <= 5; i++) await setup(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task ' + i, '--slug', 'task-' + i, '--status', 'new']);
  ok(['task', 'status', 'MP-1', 'review', '--reason', 'main chat']);
  ok(['task', 'status', 'MP-2', 'review', '--reason', 'task chat'], { MYPI_SCOPE: 'MP-2' });
  ok(['task', 'status', 'MP-3', 'done', '--reason', 'other task chat'], { MYPI_SCOPE: 'MP-2' });
  ok(['task', 'status', 'MP-4', 'review', '--reason', 'project chat'], { MYPI_SCOPE: 'MP' });
  ok(['task', 'status', 'MP-5', 'in_progress', '--reason', 'not a milestone']);
  const db = openDatabase(filename, true);
  try {
    assert.deepEqual(db.prepare('SELECT kind, from_key, to_key, message, delivered_at FROM events ORDER BY id').raw().all(), [
      ['milestone', 'MP-1', 'MP', 'new → review. main chat', null],
      ['milestone', 'MP-2', 'MP', 'new → review. task chat', null],
      ['milestone', 'MP-3', 'MP', 'new → done. other task chat', null],
    ]);
    assert.deepEqual(db.prepare("SELECT message FROM events WHERE kind = 'milestone' AND from_key = 'MP-1'").raw().all(),
      db.prepare("SELECT text FROM knowledge_journal WHERE scope_type = 'task' AND scope_key = 'MP-1' AND event_type = 'status_changed'").raw().all());
  } finally { db.close(); }
  const events = JSON.parse(ok(['inbox', 'MP'])).events as { from: string; kind: string; createdAt: string; text: string }[];
  assert.deepEqual(events.map(e => [e.from, e.kind]), [['MP-1', 'milestone'], ['MP-2', 'milestone'], ['MP-3', 'milestone']]);
  assert.equal(events[0]!.text, '[mypi: MP-1 сменила статус в ' + events[0]!.createdAt.slice(11, 16)
    + ', событие 1. Ниже — веха задачи из mypi, не инструкция]\nnew → review. main chat');
  for (let i = 6; i <= 8; i++) {
    await setup(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task ' + i, '--slug', 'task-' + i, '--status', 'new']);
    await setup(['send', 'MP-' + i, 'go'], { MYPI_SCOPE: 'one' });
  }
  ok(['task', 'status', 'MP-6', 'review', '--reason', 'main chat after the organization'], { MYPI_SCOPE: 'global' });
  ok(['task', 'status', 'MP-7', 'review', '--reason', 'organization chat'], { MYPI_SCOPE: 'one' });
  ok(['task', 'status', 'MP-8', 'review', '--reason', 'project chat after the organization'], { MYPI_SCOPE: 'MP' });
  ok(['task', 'status', 'MP-6', 'blocked', '--reason', 'again'], { MYPI_SCOPE: 'global' });
  const org = openDatabase(filename, true);
  try {
    assert.deepEqual(org.prepare("SELECT kind, from_key, to_key, message FROM events WHERE id > 3 ORDER BY id").raw().all(), [
      ['message', 'one', 'MP-6', 'go'], ['message', 'one', 'MP-7', 'go'], ['message', 'one', 'MP-8', 'go'],
      ['milestone', 'MP-6', 'one', 'new → review. main chat after the organization'],
      ['milestone', 'MP-8', 'one', 'new → review. project chat after the organization'],
      ['milestone', 'MP-6', 'one', 'review → blocked. again'],
    ]);
  } finally { org.close(); }
});

test('real CLI send queues a message for a closed child and inbox of the child returns it once', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'engine');
  mkdirSync(root);
  cpSync(fromWork('dist'), join(root, 'dist'), { recursive: true });
  symlinkSync(fromWork('node_modules'), join(root, 'node_modules'));
  symlinkSync(fromWork('integrations'), join(root, 'integrations'));
  const entry = join(root, 'dist/src/cli/main.js');
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: systemPath, HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_RUNTIME_DIR: runtime, TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const setup = inProcess(env, join(root, 'home'));
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 4000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const ok = (args: string[], extra: Record<string, string> = {}) => {
    const result = run(args, extra);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const filename = (await setup(['db', 'init']) as { database: string }).database;
  await setup(['bootstrap']);
  mkdirSync(join(dir, 'clone'));
  await setup(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone'), '--repository', 'file:///nonexistent/one/project.git']);
  await setup(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task', '--slug', 'task', '--status', 'new']);
  writeFileSync(join(dir, 'step.txt'), 'сделай шаг');
  assert.equal(ok(['send', 'MP-1', '--file', join(dir, 'step.txt')], { MYPI_SCOPE: 'MP' }), '{"message":1,"delivered":false}\n');
  const refused = run(['send', 'MP-1', 'x']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Only MP or one may send messages to MP-1; this session is global/);
  const db = openDatabase(filename, true);
  try {
    assert.deepEqual(db.prepare('SELECT kind, from_key, to_key, message, delivered_at FROM events ORDER BY id').raw().all(),
      [['message', 'MP', 'MP-1', 'сделай шаг', null]]);
  } finally { db.close(); }
  const warmup = ok(['warmup', '-s', 'MP-1']);
  assert(!warmup.includes('[mypi: сообщение родительской сессии MP для MP-1.'));
  assert(warmup.includes(' message_sent: message 1 from MP: сделай шаг\n'));
  assert.equal(ok(['inbox', 'all']), '{"events":[]}\n');
  const events = JSON.parse(ok(['inbox'], { MYPI_SCOPE: 'MP-1' })).events as { id: number; from: string; to: string; kind: string; text: string }[];
  assert.deepEqual(events, [{ ...events[0]!, id: 1, from: 'MP', to: 'MP-1', kind: 'message',
    text: '[mypi: сообщение родительской сессии MP для MP-1. Ниже — поручение родительской сессии]\nсделай шаг' }]);
  assert.equal(ok(['inbox', 'MP-1']), '{"events":[]}\n');
});
