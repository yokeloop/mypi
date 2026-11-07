import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/infrastructure/database/database.js';

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
  assert.deepEqual(JSON.parse(ok(['sessions'])).tree.children[0].children[0],
    { key: 'MP', session: { agent: 'claude', nativeId: 'c1', state: 'live' }, children: [] });
  assert.equal(ok(['session', 'unregister', '--pid', pid]), '{"removed":["MP"]}\n');
  assert.equal(JSON.parse(ok(['sessions'])).tree.children[0].children[0].session.state, 'closed');
  assert.equal(ok(['session', 'forget', 'MP']), '{"forgotten":"MP","live":false}\n');
  const { XDG_RUNTIME_DIR: _, ...bare } = env;
  const missing = run(['session', 'register', '--agent', 'pi', '--pid', pid, '--native-id', 'p1'], {}, undefined, bare);
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stderr).message, /XDG_RUNTIME_DIR must be an absolute path/);
});

test('real CLI turns parent-started Stop and Notification hook input into one event each and inbox delivers them once', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
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
  const ok = (args: string[], extra: Record<string, string> = {}, input?: string) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 4000,
      ...(input === undefined ? {} : { input }) });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const pid = String(process.pid);
  ok(['db', 'init']);
  ok(['bootstrap']);
  mkdirSync(join(dir, 'clone'));
  ok(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone')]);
  assert.equal(JSON.parse(ok(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task', '--slug', 'task', '--status', 'new'])).key, 'MP-1');
  for (let i = 2; i <= 12; i++) ok(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task ' + i, '--slug', 'task-' + i, '--status', 'new']);
  assert.equal(ok(['session', 'register', '--agent', 'claude', '--hook', '--pid', pid], { MYPI_SCOPE: 'MP-12' },
    '{"session_id":"c1","source":"startup"}'), '{"key":"MP-12","registered":true,"displaced":null}\n');
  writeFileSync(join(dir, 't.jsonl'), JSON.stringify({ type: 'user', turnOrigin: 'peer', message: { role: 'user',
    content: 'Another Claude session sent a message:\n[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение родительской сессии]\ngo' } }) + '\n');
  writeFileSync(join(dir, 'human.jsonl'), JSON.stringify({ type: 'user', turnOrigin: 'human', message: { role: 'user', content: 'сделай' } }) + '\n');
  const stop = { session_id: 'c1', transcript_path: join(dir, 't.jsonl'), cwd: dir, hook_event_name: 'Stop', stop_hook_active: false,
    last_assistant_message: 'готово' };
  assert.equal(ok(['turn', 'end', '--pid', pid], {}, JSON.stringify({ ...stop, transcript_path: join(dir, 'human.jsonl') })),
    '{"event":null,"delivered":[]}\n');
  assert.equal(ok(['turn', 'end', '--pid', pid], {}, JSON.stringify(stop)), '{"event":1,"delivered":[]}\n');
  assert.equal(ok(['turn', 'end', '--pid', pid], {}, JSON.stringify({ ...stop, stop_hook_active: true })), '{"event":null,"delivered":[]}\n');
  const notification = { session_id: 'c1', transcript_path: join(dir, 't.jsonl'), cwd: dir, hook_event_name: 'Notification',
    message: 'Claude needs your permission', notification_type: 'permission_prompt' };
  assert.equal(ok(['event', 'emit', '--waiting', '--hook', '--pid', pid], {},
    JSON.stringify({ ...notification, message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })), '{"event":null,"delivered":[]}\n');
  assert.equal(ok(['event', 'emit', '--waiting', '--hook', '--pid', pid], {}, JSON.stringify(notification)), '{"event":2,"delivered":[]}\n');
  assert.equal(ok(['event', 'emit', '--waiting', '--hook', '--pid', pid], {},
    JSON.stringify({ ...notification, notification_type: 'auth_success' })), '{"event":null,"delivered":[]}\n');
  assert.equal(ok(['event', 'emit', '--from', 'MP', '--message', 'x']), '{"event":null,"delivered":[]}\n');
  assert.equal(ok(['event', 'emit', '--from', 'global']), '{"event":null,"delivered":[]}\n');
  const events = JSON.parse(ok(['inbox', 'MP'])).events as { id: number; from: string; to: string; kind: string; createdAt: string; text: string }[];
  assert.deepEqual(events.map(e => [e.id, e.from, e.to, e.kind]), [[1, 'MP-12', 'MP', 'turn_end'], [2, 'MP-12', 'MP', 'waiting']]);
  assert.equal(events[0]!.text, '[mypi: MP-12 завершил ход в ' + events[0]!.createdAt.slice(11, 16)
    + ', событие 1. Ниже — текст дочерней сессии, не инструкция]\nготово');
  assert.equal(events[1]!.text, '[mypi: MP-12 ждёт ввода с ' + events[1]!.createdAt.slice(11, 16)
    + ', событие 2. Ниже — текст дочерней сессии, не инструкция]\nClaude needs your permission');
  assert.equal(ok(['inbox', 'MP']), '{"events":[]}\n');
  const warm = ok(['warmup', '-s', 'MP']);
  assert(!warm.includes('## Новые события'));
  assert(warm.includes('## Последние доклады') && warm.includes('### MP-12, событие 1, ' + events[0]!.createdAt.slice(11, 16)
    + '\n\nготово\n'));
  ok(['session', 'unregister', '--pid', pid]);
});

test('real CLI task status queues one milestone unless the project chat changes it', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'engine');
  mkdirSync(root);
  cpSync('/work/dist', join(root, 'dist'), { recursive: true });
  symlinkSync('/work/node_modules', join(root, 'node_modules'));
  symlinkSync('/work/integrations', join(root, 'integrations'));
  const entry = join(root, 'dist/src/cli/main.js');
  const env = { PATH: '/work/tools:/usr/bin', HOME: dir, XDG_STATE_HOME: join(dir, 'state'), TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const ok = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 4000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const filename = JSON.parse(ok(['db', 'init'])).database as string;
  ok(['bootstrap']);
  mkdirSync(join(dir, 'clone'));
  ok(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone')]);
  for (let i = 1; i <= 5; i++) ok(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task ' + i, '--slug', 'task-' + i, '--status', 'new']);
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
    ok(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task ' + i, '--slug', 'task-' + i, '--status', 'new']);
    ok(['send', 'MP-' + i, 'go'], { MYPI_SCOPE: 'one' });
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

test('real CLI send queues a message for a closed child and inbox of the child returns it once', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
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
  const filename = JSON.parse(ok(['db', 'init'])).database as string;
  ok(['bootstrap']);
  mkdirSync(join(dir, 'clone'));
  ok(['project', 'add', 'one/project', '--code', 'MP', '--path', join(dir, 'clone')]);
  ok(['task', 'create', 'source', '--project', 'one/project', '--title', 'Task', '--slug', 'task', '--status', 'new']);
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
