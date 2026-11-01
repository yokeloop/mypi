import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, resolveStatePath } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';

const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const server = fileURLToPath(new URL('../support/event-socket-server.js', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const accept = '{"crossSessionInbound":"accept"}';

const herdr = `#!/usr/bin/bash
(IFS=$'\\037'; printf '%s\\n' "$*") >> "$HERDR_LOG"
if [ "\${HERDR_FAKE:-}" = down ]; then echo '{"error":{"code":"server_not_running","message":"server is not running"}}'; exit 1; fi
case "$1 $2" in
  'workspace list') echo "{\\"result\\":{\\"type\\":\\"workspace_list\\",\\"workspaces\\":\${HERDR_FAKE_WORKSPACES:-[]}}}" ;;
  'workspace create')
    label=; previous=
    for arg in "$@"; do [ "$previous" = --label ] && label="$arg"; previous="$arg"; done
    echo "{\\"result\\":{\\"workspace\\":{\\"workspace_id\\":\\"w-$label\\",\\"label\\":\\"$label\\"},\\"tab\\":{\\"tab_id\\":\\"t-$label\\"},\\"root_pane\\":{\\"pane_id\\":\\"p-$label\\"}}}" ;;
  'tab create')
    label=; previous=
    for arg in "$@"; do [ "$previous" = --label ] && label="$arg"; previous="$arg"; done
    if [ -n "\${HERDR_FAKE_TAB_FAIL:-}" ] && [ "$label" = "$HERDR_FAKE_TAB_FAIL" ]; then echo '{"error":{"code":"tab_failed","message":"boom"}}'; exit 1; fi
    echo '{"result":{"tab":{"tab_id":"t1","workspace_id":"w1"},"root_pane":{"pane_id":"p1"}}}' ;;
  'tab rename') echo '{"result":{"type":"ok"}}' ;;
  'agent start')
    sleep 1000 < /dev/null > /dev/null 2>&1 &
    echo "$!" >> "$HERDR_CHILDREN"
    MYPI_SCOPE="\${3^^}" "$FAKE_NODE" "$FAKE_CLI" session register --agent "$5" --native-id "fake-$3" --pid "$!" \\
      \${HERDR_FAKE_SOCKET:+--socket "$HERDR_FAKE_SOCKET"} > /dev/null
    echo "{\\"type\\":\\"agent_started\\",\\"name\\":\\"$3\\",\\"pane_id\\":\\"p1\\"}" ;;
  'agent focus')
    if [ "\${HERDR_FAKE_FOCUS:-}" = fail ]; then echo '{"error":{"code":"agent_not_found","message":"no agent"}}'; exit 1; fi
    echo '{"result":{"type":"ok"}}' ;;
esac
`;

function git(...args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
    { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  assert.equal(result.status, 0, result.stderr);
}

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-open-'));
  const bin = join(dir, 'bin'), runtime = join(dir, 'run'), log = join(dir, 'herdr.log'), childList = join(dir, 'children');
  const children = () => existsSync(childList) ? readFileSync(childList, 'utf8').split('\n').filter(line => line !== '') : [];
  t.after(() => {
    for (const child of children()) { try { process.kill(Number(child)); } catch {} }
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(bin);
  mkdirSync(runtime, { mode: 0o700 });
  writeFileSync(join(bin, 'herdr'), herdr, { mode: 0o755 });
  const env: Record<string, string> = { PATH: bin + ':/work/tools:/usr/bin', HOME: dir, XDG_STATE_HOME: join(dir, 'state'),
    XDG_RUNTIME_DIR: runtime, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HERDR_LOG: log,
    HERDR_CHILDREN: childList, FAKE_NODE: process.execPath, FAKE_CLI: entry };
  const cli = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const ok = (args: string[], extra: Record<string, string> = {}) => {
    const result = cli(args, extra);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as { opened: { key: string; agent: string; action: string; workspaceId: string | null; worktreePath: string | null;
      notes: string[]; message: number | null }[] };
  };
  const failed = (args: string[], extra: Record<string, string> = {}) => {
    const result = cli(args, extra);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.stdout, '');
    return JSON.parse(result.stderr) as { status: string; message: string; saved?: string[]; missing?: string[] };
  };
  const bare = join(dir, 'remote.git'), seed = join(dir, 'seed'), clone = join(dir, 'projects', 'one', 'project');
  git('init', '--bare', '--quiet', '--initial-branch=main', bare);
  git('init', '--quiet', '--initial-branch=main', seed);
  writeFileSync(join(seed, 'README.md'), 'seed');
  git('-C', seed, 'add', 'README.md');
  git('-C', seed, 'commit', '--quiet', '-m', 'seed');
  git('-C', seed, 'remote', 'add', 'origin', bare);
  git('-C', seed, 'push', '--quiet', 'origin', 'main');
  mkdirSync(join(dir, 'projects', 'one'), { recursive: true });
  git('clone', '--quiet', bare, clone);
  const other = join(dir, 'projects', 'two', 'other');
  mkdirSync(join(dir, 'projects', 'two'), { recursive: true });
  git('clone', '--quiet', bare, other);
  assert.equal(cli(['db', 'init']).status, 0);
  const filename = resolveStatePath(env, dir);
  const app = createApp(filename, false);
  try {
    const projectId = app.projects.add('one/project', 'MP', clone).id;
    app.projects.add('one/noclone', 'NC');
    app.projects.add('two/other', 'OT', other);
    app.tasks.create({ projectId, slug: 'open', title: 'open', status: 'new' }, () => {});
  } finally { app.close(); }
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(line => line !== '').map(line => line.split('\u001f')) : [];
  const reset = () => rmSync(log, { force: true });
  const rows = () => {
    const db = openDatabase(filename, true);
    try { return (db.prepare('SELECT key FROM sessions').all() as { key: string }[]).map(r => r.key); } finally { db.close(); }
  };
  const worktreePaths = () => {
    const app = createApp(filename, true);
    try { return app.tasks.list().map(card => card.worktreePath); } finally { app.close(); }
  };
  const events = () => {
    const db = openDatabase(filename, true);
    try { return db.prepare('SELECT id, kind, delivered_at IS NOT NULL AS delivered FROM events ORDER BY id').all(); } finally { db.close(); }
  };
  const quit = () => { for (const child of children()) assert.equal(cli(['session', 'unregister', '--pid', child]).status, 0); };
  const sock = join(dir, 'child.sock'), serverLog = join(dir, 'server.log');
  const listen = async (mode: 'ack' | 'claude') => {
    const child = spawn(process.execPath, [server, sock, mode, serverLog], { stdio: ['ignore', 'pipe', 'inherit'] });
    t.after(() => { child.kill(); });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error('Socket server exited: ' + code)));
      child.stdout.setEncoding('utf8');
      let out = '';
      child.stdout.on('data', (chunk: string) => { out += chunk; if (out.includes('ready\n')) resolve(); });
    });
  };
  const received = () => existsSync(serverLog) ? readFileSync(serverLog, 'utf8').split('\n').filter(line => line !== '').map(line => JSON.parse(line)) : [];
  const pid = String(process.pid);
  return { env, cli, ok, failed, calls, reset, rows, worktreePaths, events, quit, listen, received, sock, pid,
    worktree: realpathSync(clone) + '--MP-1-open' };
}

const workspace = (label: string, key: string, state: string) =>
  ['workspace', 'create', '--cwd', root, '--label', label, '--env', 'MYPI_SCOPE=' + key, '--env', 'XDG_STATE_HOME=' + state, '--no-focus'];
const tab = (workspace: string, label: string, key: string, state: string) =>
  ['tab', 'create', '--workspace', workspace, '--cwd', root, '--label', label, '--env', 'MYPI_SCOPE=' + key, '--env', 'XDG_STATE_HOME=' + state, '--no-focus'];

test('open puts a project and its task into one project workspace whatever HERDR_WORKSPACE_ID says', t => {
  const { env, ok, calls, rows, worktree } = fixture(t);
  const result = ok(['open', 'MP', 'MP-1'], { HERDR_WORKSPACE_ID: 'w1' });
  assert.deepEqual(result.opened.map(o => [o.key, o.agent, o.action, o.worktreePath]),
    [['MP', 'claude', 'started', null], ['MP-1', 'claude', 'started', worktree]]);
  assert.ok(existsSync(worktree));
  const log = calls();
  const uuids = [log[3]![9]!, log[5]![9]!];
  for (const uuid of uuids) assert.match(uuid, /^[0-9a-f-]{36}$/);
  assert.notEqual(uuids[0], uuids[1]);
  assert.deepEqual(log, [
    ['workspace', 'list'],
    workspace('one/project', 'MP', env['XDG_STATE_HOME']!),
    ['tab', 'rename', 't-one/project', 'mp'],
    ['agent', 'start', 'mp', '--kind', 'claude', '--pane', 'p-one/project', '--', '--session-id', uuids[0]!, '--name', 'MP', '--settings', accept],
    tab('w-one/project', 'mp-1', 'MP-1', env['XDG_STATE_HOME']!),
    ['agent', 'start', 'mp-1', '--kind', 'claude', '--pane', 'p1', '--', '--session-id', uuids[1]!, '--name', 'MP-1', '--settings', accept],
  ]);
  assert.ok(!log.some(c => c.includes('w1')));
  assert.equal(log.filter(c => c[0] === 'workspace' && c[1] === 'create').length, 1);
  assert.deepEqual(rows(), ['MP', 'MP-1']);
});

test('open finds the project workspace by its label and gives another project its own', t => {
  const { env, ok, calls } = fixture(t);
  const result = ok(['open', 'MP', 'OT'], { HERDR_FAKE_WORKSPACES:
    '[{"workspace_id":"w8","label":"mypi","focused":true},{"workspace_id":"w9","label":"one/project","focused":false},{"workspace_id":"w10","label":"one/project","focused":false}]' });
  const log = calls();
  assert.deepEqual(log.map(c => c[0] === 'agent' ? c.slice(0, 7) : c), [
    ['workspace', 'list'],
    tab('w9', 'mp', 'MP', env['XDG_STATE_HOME']!),
    ['agent', 'start', 'mp', '--kind', 'claude', '--pane', 'p1'],
    workspace('two/other', 'OT', env['XDG_STATE_HOME']!),
    ['tab', 'rename', 't-two/other', 'ot'],
    ['agent', 'start', 'ot', '--kind', 'claude', '--pane', 'p-two/other'],
  ]);
  assert.deepEqual(result.opened.map(o => [o.key, o.workspaceId]), [['MP', 'w9'], ['OT', 'w-two/other']]);
  assert.ok(!log.some(c => c.includes('w8') || c.includes('mypi')));
});

test('open of a task without its project workspace creates the workspace with only the task tab', t => {
  const { env, ok, calls } = fixture(t);
  assert.deepEqual(ok(['open', 'MP-1']).opened.map(o => [o.key, o.notes]),
    [['MP-1', ['start message not delivered: the session has no event socket']]]);
  assert.deepEqual(calls().map(c => c[0] === 'agent' ? c.slice(0, 7) : c), [
    ['workspace', 'list'],
    workspace('one/project', 'MP-1', env['XDG_STATE_HOME']!),
    ['tab', 'rename', 't-one/project', 'mp-1'],
    ['agent', 'start', 'mp-1', '--kind', 'claude', '--pane', 'p-one/project'],
  ]);
});

test('open focuses a live session and continues it with its own agent', t => {
  const { cli, ok, failed, calls, reset, pid } = fixture(t);
  assert.equal(cli(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid], { MYPI_SCOPE: 'MP-1' }).status, 0);
  const result = ok(['open', 'MP-1', '--agent', 'pi']);
  assert.deepEqual(result.opened.map(o => [o.key, o.agent, o.action, o.notes]),
    [['MP-1', 'claude', 'focused', ['MP-1 continues with its agent claude; --agent pi applies only to new sessions']]]);
  assert.deepEqual(calls(), [['workspace', 'list'], ['agent', 'focus', 'mp-1']]);
  reset();
  const error = failed(['open', 'MP-1'], { HERDR_FAKE_FOCUS: 'fail' });
  assert.ok(error.message.includes('is live (claude, pid ' + pid + ')'), error.message);
  assert.ok(error.message.includes('no new tab was created'), error.message);
  assert.ok(!calls().some(c => c[0] === 'tab'));
});

test('open resumes a closed session with its saved agent and passes the requested mode', t => {
  const { cli, ok, calls, reset, pid } = fixture(t);
  assert.equal(cli(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid], { MYPI_SCOPE: 'MP-1' }).status, 0);
  assert.equal(cli(['session', 'unregister', '--pid', pid]).status, 0);
  const claude = ok(['open', 'MP-1', '--permission-mode', 'plan']);
  assert.deepEqual(claude.opened.map(o => [o.key, o.agent, o.action]), [['MP-1', 'claude', 'resumed']]);
  assert.deepEqual(calls().at(-1), ['agent', 'start', 'mp-1', '--kind', 'claude', '--pane', 'p-one/project', '--', '--resume', 'c1', '--permission-mode', 'plan',
    '--settings', accept]);
  reset();
  assert.equal(cli(['session', 'register', '--agent', 'pi', '--native-id', 'p9', '--pid', pid], { MYPI_SCOPE: 'MP' }).status, 0);
  assert.equal(cli(['session', 'unregister', '--pid', pid]).status, 0);
  const pi = ok(['open', 'MP', '--permission-mode', 'auto']);
  assert.deepEqual(pi.opened.map(o => [o.key, o.agent, o.action, o.notes]), [['MP', 'pi', 'resumed', ['Pi has no permission mode; auto was not passed to MP']]]);
  assert.deepEqual(calls().at(-1), ['agent', 'start', 'mp', '--kind', 'pi', '--pane', 'p-one/project', '--', '--session-id', 'p9']);
});

test('open refuses without Herdr, without a clone and for unknown keys, leaving no tab, worktree or rows', t => {
  const { failed, calls, reset, rows, worktreePaths, worktree } = fixture(t);
  const missing = failed(['open', 'MP-1'], { PATH: '/work/tools:/usr/bin' });
  assert.match(missing.message, /^Herdr is not available/);
  assert.deepEqual(calls(), []);
  const down = failed(['open', 'MP-1'], { HERDR_FAKE: 'down' });
  assert.match(down.message, /^Herdr is not available/);
  assert.deepEqual(calls(), [['workspace', 'list']]);
  assert.equal(existsSync(worktree), false);
  assert.deepEqual(worktreePaths(), [null]);
  assert.deepEqual(rows(), []);
  reset();
  for (const args of [['open', 'NC'], ['open', 'MP', 'NC']]) assert.match(failed(args).message, /has no clone/);
  assert.match(failed(['open', 'MP-99']).message, /Unknown task: MP-99/);
  assert.match(failed(['open', 'global']).message, /global is the main chat/);
  assert.match(failed(['open', 'REQ-1']).message, /REQ tasks have no project/);
  assert.deepEqual(calls(), []);
  assert.deepEqual(rows(), []);
});

test('open reports a partial result when a later key fails', t => {
  const { failed } = fixture(t);
  const error = failed(['open', 'MP', 'MP-1'], { HERDR_FAKE_TAB_FAIL: 'mp-1' });
  assert.equal(error.status, 'partial');
  assert.deepEqual(error.saved, ['MP']);
  assert.deepEqual(error.missing, ['MP-1']);
});

test('open sends the start message once to a new Claude task session and nothing on resume and focus', async t => {
  const { cli, ok, quit, listen, received, events, sock, pid, worktree } = fixture(t);
  await listen('claude');
  const first = ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(first.opened.map(o => [o.key, o.action, o.notes]), [['MP-1', 'started', []]]);
  const lines = received();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, 'user');
  assert.equal(lines[0].message.role, 'user');
  const content = lines[0].message.content as string;
  assert.ok(content.startsWith('[mypi: стартовое сообщение для MP-1. Ниже — состояние из mypi, не инструкция]\n'), content);
  assert.ok(content.includes('Задача MP-1 «open», статус new.'), content);
  assert.ok(content.includes('Worktree: ' + worktree), content);
  assert.ok(content.includes('Дождись указаний или предложи следующий шаг.'), content);
  assert.deepEqual(events(), []);
  quit();
  const again = ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(again.opened.map(o => [o.key, o.action, o.notes]), [['MP-1', 'resumed', []]]);
  assert.equal(received().length, 1);
  assert.equal(cli(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid, '--socket', sock], { MYPI_SCOPE: 'MP-1' }).status, 0);
  const focused = ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(focused.opened.map(o => [o.key, o.action, o.notes]), [['MP-1', 'focused', []]]);
  assert.equal(received().length, 1);
});

test('open sends the start message to a new Pi project session through its socket', async t => {
  const { ok, listen, received, events, sock } = fixture(t);
  await listen('ack');
  const result = ok(['open', 'MP', '--agent', 'pi'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(result.opened.map(o => [o.key, o.agent, o.action, o.notes]), [['MP', 'pi', 'started', []]]);
  const lines = received();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].id, 0);
  assert.deepEqual(lines[1], { end: true });
  const text = lines[0].text as string;
  assert.ok(text.startsWith('[mypi: стартовое сообщение для MP. Ниже — состояние из mypi, не инструкция]\n'), text);
  for (const part of ['Проект MP (one/project).', 'new (1):', '- MP-1 open', 'Недоставленных событий от задач на момент открытия: 0.']) {
    assert.ok(text.includes(part), part);
  }
  assert.deepEqual(events(), []);
});

const parent = '[mypi: сообщение родительской сессии MP для MP-1. Ниже — поручение родительской сессии]\n';

test('open with a message starts a Claude task session with one line carrying the start text and the parent frame', async t => {
  const { ok, listen, received, events, sock } = fixture(t);
  await listen('claude');
  const result = ok(['open', 'MP-1', '--message', 'сделай шаг'], { HERDR_FAKE_SOCKET: sock, MYPI_SCOPE: 'MP' });
  assert.deepEqual(result.opened.map(o => [o.key, o.action, o.notes, o.message]), [['MP-1', 'started', [], 1]]);
  const lines = received();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, 'user');
  const content = lines[0].message.content as string;
  assert.ok(content.startsWith('[mypi: стартовое сообщение для MP-1. Ниже — состояние из mypi, не инструкция]\n'), content);
  assert.ok(content.endsWith('Дождись указаний или предложи следующий шаг.\n\n' + parent + 'сделай шаг'), content);
  assert.deepEqual(events(), [{ id: 1, kind: 'message', delivered: 1 }]);
});

test('open resumes a closed child and delivers its queued messages once', async t => {
  const { cli, ok, quit, listen, received, events, sock } = fixture(t);
  await listen('claude');
  assert.equal(ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock }).opened[0]!.message, null);
  assert.equal(received().length, 1);
  quit();
  const sent = cli(['send', 'MP-1', 'go on'], { MYPI_SCOPE: 'MP' });
  assert.equal(sent.stdout, '{"message":1,"delivered":false}\n', sent.stderr);
  assert.deepEqual(events(), [{ id: 1, kind: 'message', delivered: 0 }]);
  const resumed = ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(resumed.opened.map(o => [o.key, o.action, o.notes, o.message]), [['MP-1', 'resumed', [], null]]);
  const lines = received();
  assert.equal(lines.length, 2);
  assert.equal(lines[1].message.content, parent + 'go on');
  assert.deepEqual(events(), [{ id: 1, kind: 'message', delivered: 1 }]);
  quit();
  assert.deepEqual(ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock }).opened.map(o => [o.action, o.notes]), [['resumed', []]]);
  assert.equal(received().length, 2);
});

test('open with a message focuses a live child and sends it live', async t => {
  const { cli, ok, calls, listen, received, events, sock, pid } = fixture(t);
  await listen('claude');
  assert.equal(cli(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid, '--socket', sock], { MYPI_SCOPE: 'MP-1' }).status, 0);
  const result = ok(['open', 'MP-1', '--message', 'go'], { MYPI_SCOPE: 'MP' });
  assert.deepEqual(result.opened.map(o => [o.key, o.action, o.notes, o.message]), [['MP-1', 'focused', [], 1]]);
  assert.deepEqual(calls(), [['workspace', 'list'], ['agent', 'focus', 'mp-1']]);
  assert.deepEqual(received().map(line => line.message.content), [parent + 'go']);
  assert.deepEqual(events(), [{ id: 1, kind: 'message', delivered: 1 }]);
});

test('open with a message from a non-parent or for two keys opens nothing', t => {
  const { failed, calls, rows, events, worktreePaths, worktree } = fixture(t);
  assert.match(failed(['open', 'MP-1', '--message', 'go'], { MYPI_SCOPE: 'global' }).message,
    /Only MP may send messages to MP-1; this session is global/);
  assert.match(failed(['open', 'MP', 'MP-1', '--message', 'go'], { MYPI_SCOPE: 'MP' }).message, /--message takes exactly one key/);
  assert.match(failed(['open', 'MP-1', '--message', ' '], { MYPI_SCOPE: 'MP' }).message, /Message text is empty/);
  assert.deepEqual(calls(), []);
  assert.equal(existsSync(worktree), false);
  assert.deepEqual(worktreePaths(), [null]);
  assert.deepEqual(rows(), []);
  assert.deepEqual(events(), []);
});
