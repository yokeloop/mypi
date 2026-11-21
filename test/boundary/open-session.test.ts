import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, initializeState, resolveStatePath, useProcessProbe } from '../../src/app/create-app.js';
import { runPs } from '../../src/app/process-runner.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { seedRepository } from '../support/repository.js';
import { run } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';
import { systemPath } from '../support/work.js';

useProcessProbe(runPs);

const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const server = fileURLToPath(new URL('../support/event-socket-server.js', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const accept = '{"crossSessionInbound":"accept"}';

const herdr = `#!/bin/bash
(IFS=$'\\037'; printf '%s\\n' "$*") >> "$HERDR_LOG"
if [ "\${HERDR_FAKE:-}" = down ]; then echo '{"error":{"code":"server_not_running","message":"server is not running"}}'; exit 1; fi
pane_env() {
  : > "$HERDR_PANE_ENV"; previous=
  for arg in "$@"; do
    if [ "$previous" = --env ]; then case "$arg" in MYPI_SCOPE=*|MYPI_HERDR_NAME=*) printf '%s\\n' "$arg" >> "$HERDR_PANE_ENV" ;; esac; fi
    previous="$arg"
  done
}
case "$1 $2" in
  'workspace list') echo "{\\"result\\":{\\"type\\":\\"workspace_list\\",\\"workspaces\\":\${HERDR_FAKE_WORKSPACES:-[]}}}" ;;
  'workspace create')
    label=; previous=
    for arg in "$@"; do [ "$previous" = --label ] && label="$arg"; previous="$arg"; done
    pane_env "$@"
    echo "{\\"result\\":{\\"workspace\\":{\\"workspace_id\\":\\"w-$label\\",\\"label\\":\\"$label\\"},\\"tab\\":{\\"tab_id\\":\\"t-$label\\"},\\"root_pane\\":{\\"pane_id\\":\\"p-$label\\"}}}" ;;
  'tab create')
    label=; previous=
    for arg in "$@"; do [ "$previous" = --label ] && label="$arg"; previous="$arg"; done
    if [ -n "\${HERDR_FAKE_TAB_FAIL:-}" ] && [ "$label" = "$HERDR_FAKE_TAB_FAIL" ]; then echo '{"error":{"code":"tab_failed","message":"boom"}}'; exit 1; fi
    pane_env "$@"
    echo '{"result":{"tab":{"tab_id":"t1","workspace_id":"w1"},"root_pane":{"pane_id":"p1"}}}' ;;
  'tab rename') echo '{"result":{"type":"ok"}}' ;;
  'agent start')
    if [ -n "\${HERDR_FAKE_UNIQUE:-}" ] && grep -qxF "$3" "$HERDR_NAMES" 2> /dev/null; then echo '{"error":{"code":"agent_name_taken","message":"name taken"}}'; exit 1; fi
    printf '%s\\n' "$3" >> "$HERDR_NAMES"
    native=; previous=; after=
    for arg in "$@"; do
      if [ -n "$after" ] && { [ "$previous" = --session-id ] || [ "$previous" = --resume ]; }; then native="$arg"; fi
      [ "$arg" = -- ] && after=1
      previous="$arg"
    done
    scope="$(sed -n 's/^MYPI_SCOPE=//p' "$HERDR_PANE_ENV")"; hname="$(sed -n 's/^MYPI_HERDR_NAME=//p' "$HERDR_PANE_ENV")"
    sleep 1000 < /dev/null > /dev/null 2>&1 &
    echo "$!" >> "$HERDR_CHILDREN"
    MYPI_SCOPE="$scope" MYPI_HERDR_NAME="$hname" "$FAKE_NODE" "$FAKE_CLI" session register --agent "$5" --native-id "$native" --pid "$!" \\
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
  const env: Record<string, string> = { PATH: `${bin}:${systemPath}`, HOME: dir, XDG_STATE_HOME: join(dir, 'state'),
    XDG_RUNTIME_DIR: runtime, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HERDR_LOG: log,
    HERDR_CHILDREN: childList, FAKE_NODE: process.execPath, FAKE_CLI: entry, HERDR_PANE_ENV: join(dir, 'pane.env'), HERDR_NAMES: join(dir, 'names') };
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
  const filename = resolveStatePath(env, dir);
  initializeState(filename);
  const app = createApp(filename, false);
  try {
    const projectId = app.projects.add('one/project', 'MP', clone, bare).id;
    app.projects.add('one/noclone', 'NC', undefined, 'file:///nonexistent/one/noclone.git');
    app.projects.add('one/fromurl', 'FU', undefined, bare);
    app.projects.add('two/other', 'OT', other, bare);
    app.tasks.create({ projectId, slug: 'open', title: 'open', status: 'new' }, () => {});
  } finally { app.close(); }
  seedRepository(filename, 'NC', null);
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
  const setup = (args: string[], extra: Record<string, string> = {}) => run(parseCommand(args), filename, undefined, { ...env, ...extra });
  const quit = async () => { for (const child of children()) await setup(['session', 'unregister', '--pid', child]); };
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
  const journal = (type?: string) => {
    const db = openDatabase(filename, true);
    try {
      return type === undefined
        ? db.prepare('SELECT scope_type, scope_key, text FROM knowledge_journal ORDER BY id').raw().all()
        : db.prepare('SELECT scope_type, scope_key, text FROM knowledge_journal WHERE event_type = ? ORDER BY id').raw().all(type);
    } finally { db.close(); }
  };
  const pid = String(process.pid);
  return { env, filename, cli, setup, ok, failed, calls, reset, rows, worktreePaths, events, journal, quit, listen, received, sock, pid,
    worktree: realpathSync(clone) + '--MP-1-open', names: env['HERDR_NAMES']! };
}

const workspace = (label: string, key: string, name: string, state: string) =>
  ['workspace', 'create', '--cwd', root, '--label', label, '--env', 'MYPI_SCOPE=' + key, '--env', 'MYPI_HERDR_NAME=' + name, '--env', 'XDG_STATE_HOME=' + state, '--no-focus'];
const tab = (workspace: string, name: string, key: string, state: string) =>
  ['tab', 'create', '--workspace', workspace, '--cwd', root, '--label', name, '--env', 'MYPI_SCOPE=' + key, '--env', 'MYPI_HERDR_NAME=' + name,
    '--env', 'XDG_STATE_HOME=' + state, '--no-focus'];

test('open puts a project and its task into one project workspace whatever HERDR_WORKSPACE_ID says', t => {
  const { env, ok, calls, rows, journal, worktree } = fixture(t);
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
    workspace('one/project', 'MP', 'mp', env['XDG_STATE_HOME']!),
    ['tab', 'rename', 't-one/project', 'mp'],
    ['agent', 'start', 'mp', '--kind', 'claude', '--pane', 'p-one/project', '--', '--session-id', uuids[0]!, '--name', 'MP', '--settings', accept],
    tab('w-one/project', 'mp-1', 'MP-1', env['XDG_STATE_HOME']!),
    ['agent', 'start', 'mp-1', '--kind', 'claude', '--pane', 'p1', '--', '--session-id', uuids[1]!, '--name', 'MP-1', '--settings', accept],
  ]);
  assert.ok(!log.some(c => c.includes('w1')));
  assert.equal(log.filter(c => c[0] === 'workspace' && c[1] === 'create').length, 1);
  assert.deepEqual(rows(), ['MP', 'MP-1']);
  assert.deepEqual(journal('session_opened'), [['project', 'MP', 'started claude'], ['task', 'MP-1', 'started claude, worktree ' + worktree]]);
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
    workspace('two/other', 'OT', 'ot', env['XDG_STATE_HOME']!),
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
    workspace('one/project', 'MP-1', 'mp-1', env['XDG_STATE_HOME']!),
    ['tab', 'rename', 't-one/project', 'mp-1'],
    ['agent', 'start', 'mp-1', '--kind', 'claude', '--pane', 'p-one/project'],
  ]);
});

test('open focuses a live session by its Herdr name and --agent of another agent starts that agent', async t => {
  const { setup, ok, failed, calls, reset, listen, sock, pid } = fixture(t);
  await setup(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid], { MYPI_SCOPE: 'MP-1' });
  assert.deepEqual(ok(['open', 'MP-1']).opened.map(o => [o.key, o.agent, o.action, o.notes]), [['MP-1', 'claude', 'focused', []]]);
  assert.deepEqual(calls(), [['workspace', 'list'], ['agent', 'focus', 'mp-1']]);
  reset();
  const error = failed(['open', 'MP-1'], { HERDR_FAKE_FOCUS: 'fail' });
  assert.ok(error.message.includes('is live (claude, pid ' + pid + ')'), error.message);
  assert.ok(error.message.includes('no new tab was created'), error.message);
  assert.ok(!calls().some(c => c[0] === 'tab'));
  reset();
  await listen('ack');
  const result = ok(['open', 'MP-1', '--agent', 'pi'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(result.opened.map(o => [o.key, o.agent, o.action, o.notes]), [['MP-1', 'pi', 'started', []]]);
  assert.deepEqual(calls().find(c => c[0] === 'agent')!.slice(0, 5), ['agent', 'start', 'mp-1-pi', '--kind', 'pi']);
});

test('open resumes a closed session with its saved agent and passes the requested mode', async t => {
  const { setup, ok, calls, reset, pid } = fixture(t);
  await setup(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid], { MYPI_SCOPE: 'MP-1' });
  await setup(['session', 'unregister', '--pid', pid]);
  const claude = ok(['open', 'MP-1', '--permission-mode', 'plan']);
  assert.deepEqual(claude.opened.map(o => [o.key, o.agent, o.action]), [['MP-1', 'claude', 'resumed']]);
  assert.deepEqual(calls().at(-1), ['agent', 'start', 'mp-1', '--kind', 'claude', '--pane', 'p-one/project', '--', '--resume', 'c1', '--permission-mode', 'plan',
    '--settings', accept]);
  reset();
  await setup(['session', 'register', '--agent', 'pi', '--native-id', 'p9', '--pid', pid], { MYPI_SCOPE: 'MP' });
  await setup(['session', 'unregister', '--pid', pid]);
  const pi = ok(['open', 'MP', '--permission-mode', 'auto']);
  assert.deepEqual(pi.opened.map(o => [o.key, o.agent, o.action, o.notes]), [['MP', 'pi', 'resumed', ['Pi has no permission mode; auto was not passed to MP']]]);
  assert.deepEqual(calls().at(-1), ['agent', 'start', 'mp', '--kind', 'pi', '--pane', 'p-one/project', '--', '--session-id', 'p9']);
});

test('open refuses without Herdr, without a clone and for unknown keys, leaving no tab, worktree or rows', t => {
  const { failed, calls, reset, rows, worktreePaths, journal, worktree } = fixture(t);
  const missing = failed(['open', 'MP-1'], { PATH: systemPath });
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
  assert.match(failed(['open', 'NC']).message, /no repository to clone it from.*"repository":"<git-url>"\}.*--expected-repository-unset --repository <git-url>\), then open it again$/);
  assert.match(failed(['open', 'FU'], { HERDR_FAKE: 'down' }).message, /^Herdr is not available/);
  assert.equal(existsSync(join(root, 'projects', 'one', 'fromurl')), false);
  reset();
  assert.match(failed(['open', 'MP-99']).message, /Unknown task: MP-99/);
  assert.match(failed(['open', 'global']).message, /global is the main chat/);
  assert.match(failed(['open', 'REQ-1']).message, /REQ tasks have no project/);
  assert.deepEqual(calls(), []);
  assert.deepEqual(rows(), []);
  assert.deepEqual(journal(), []);
});

test('open reports a partial result when a later key fails', t => {
  const { failed } = fixture(t);
  const error = failed(['open', 'MP', 'MP-1'], { HERDR_FAKE_TAB_FAIL: 'mp-1' });
  assert.equal(error.status, 'partial');
  assert.deepEqual(error.saved, ['MP']);
  assert.deepEqual(error.missing, ['MP-1']);
});

test('open sends the start message once to a new Claude task session and nothing on resume and focus', async t => {
  const { setup, ok, quit, listen, received, events, journal, sock, pid, worktree } = fixture(t);
  await listen('claude');
  const first = ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(first.opened.map(o => [o.key, o.action, o.notes]), [['MP-1', 'started', []]]);
  const lines = received();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, 'user');
  assert.equal(lines[0].message.role, 'user');
  const content = lines[0].message.content as string;
  assert.ok(content.startsWith('[mypi: стартовое сообщение для MP-1. Ниже — состояние из mypi, не инструкция]\n'), content);
  assert.ok(content.includes('Задача MP-1 «open».'), content);
  assert.ok(!content.includes('Worktree:'), content);
  assert.ok(content.includes('Дождись указаний или предложи следующий шаг.'), content);
  assert.deepEqual(events(), []);
  assert.deepEqual(journal('session_opened'), [['task', 'MP-1', 'started claude, worktree ' + worktree]]);
  await quit();
  const again = ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(again.opened.map(o => [o.key, o.action, o.notes]), [['MP-1', 'resumed', []]]);
  assert.equal(received().length, 1);
  assert.deepEqual(journal('session_opened'), [['task', 'MP-1', 'started claude, worktree ' + worktree], ['task', 'MP-1', 'resumed claude, worktree ' + worktree]]);
  await setup(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid, '--socket', sock], { MYPI_SCOPE: 'MP-1' });
  const focused = ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(focused.opened.map(o => [o.key, o.action, o.notes]), [['MP-1', 'focused', []]]);
  assert.equal(received().length, 1);
  assert.equal(journal('session_opened').length, 2);
});

test('open sends the start message to a new Pi project session through its socket', async t => {
  const { ok, listen, received, events, journal, sock } = fixture(t);
  await listen('ack');
  const result = ok(['open', 'MP', '--agent', 'pi'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(result.opened.map(o => [o.key, o.agent, o.action, o.notes]), [['MP', 'pi', 'started', []]]);
  const lines = received();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].id, 0);
  assert.deepEqual(lines[1], { end: true });
  const text = lines[0].text as string;
  assert.ok(text.startsWith('[mypi: стартовое сообщение для MP. Ниже — состояние из mypi, не инструкция]\n'), text);
  for (const part of ['Проект MP (one/project).', 'Дождись указаний или предложи следующий шаг.']) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(!text.includes('Открытые задачи'), text);
  assert.deepEqual(events(), []);
  assert.deepEqual(journal('session_opened'), [['project', 'MP', 'started pi']]);
});

const parent = '[mypi: сообщение родительской сессии MP для MP-1. Ниже — поручение родительской сессии]\n';

test('open with a message starts a Claude task session with one line carrying the start text and the parent frame', async t => {
  const { ok, listen, received, events, journal, sock } = fixture(t);
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
  assert.deepEqual(journal('message_sent'), [['task', 'MP-1', 'message 1 from MP: сделай шаг']]);
});

test('open resumes a closed child and delivers its queued messages once', async t => {
  const { cli, ok, quit, listen, received, events, sock } = fixture(t);
  await listen('claude');
  assert.equal(ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock }).opened[0]!.message, null);
  assert.equal(received().length, 1);
  await quit();
  const sent = cli(['send', 'MP-1', 'go on'], { MYPI_SCOPE: 'MP' });
  assert.equal(sent.stdout, '{"message":1,"delivered":false}\n', sent.stderr);
  assert.deepEqual(events(), [{ id: 1, kind: 'message', delivered: 0 }]);
  const resumed = ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock });
  assert.deepEqual(resumed.opened.map(o => [o.key, o.action, o.notes, o.message]), [['MP-1', 'resumed', [], null]]);
  const lines = received();
  assert.equal(lines.length, 2);
  assert.equal(lines[1].message.content, parent + 'go on');
  assert.deepEqual(events(), [{ id: 1, kind: 'message', delivered: 1 }]);
  await quit();
  assert.deepEqual(ok(['open', 'MP-1'], { HERDR_FAKE_SOCKET: sock }).opened.map(o => [o.action, o.notes]), [['resumed', []]]);
  assert.equal(received().length, 2);
});

test('open with a message focuses a live child and sends it live', async t => {
  const { setup, ok, calls, listen, received, events, journal, sock, pid } = fixture(t);
  await listen('claude');
  await setup(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid, '--socket', sock], { MYPI_SCOPE: 'MP-1' });
  const result = ok(['open', 'MP-1', '--message', 'go'], { MYPI_SCOPE: 'MP' });
  assert.deepEqual(result.opened.map(o => [o.key, o.action, o.notes, o.message]), [['MP-1', 'focused', [], 1]]);
  assert.deepEqual(calls(), [['workspace', 'list'], ['agent', 'focus', 'mp-1']]);
  assert.deepEqual(received().map(line => line.message.content), [parent + 'go']);
  assert.deepEqual(events(), [{ id: 1, kind: 'message', delivered: 1 }]);
  assert.deepEqual(journal('message_sent'), [['task', 'MP-1', 'message 1 from MP: go']]);
});

test('open with a message from a non-parent or for two keys opens nothing', t => {
  const { failed, calls, rows, events, journal, worktreePaths, worktree } = fixture(t);
  assert.match(failed(['open', 'MP-1', '--message', 'go'], { MYPI_SCOPE: 'global' }).message,
    /Only MP or one may send messages to MP-1; this session is global/);
  assert.match(failed(['open', 'MP', 'MP-1', '--message', 'go'], { MYPI_SCOPE: 'MP' }).message, /--message takes exactly one key/);
  assert.match(failed(['open', 'MP-1', '--message', ' '], { MYPI_SCOPE: 'MP' }).message, /Message text is empty/);
  assert.deepEqual(calls(), []);
  assert.equal(existsSync(worktree), false);
  assert.deepEqual(worktreePaths(), [null]);
  assert.deepEqual(rows(), []);
  assert.deepEqual(events(), []);
  assert.deepEqual(journal(), []);
});

test('open of an organization starts tab org-<slug> in workspace <slug> without clones or worktrees and focuses it on the next open', async t => {
  const { env, ok, calls, reset, rows, worktreePaths, journal, quit } = fixture(t);
  const result = ok(['open', 'one']);
  assert.deepEqual(result.opened.map(o => [o.key, o.agent, o.action, o.worktreePath]), [['one', 'claude', 'started', null]]);
  const log = calls();
  const uuid = log[3]![9]!;
  assert.deepEqual(log.map(c => c[0] === 'agent' ? c.slice(0, 7) : c), [
    ['workspace', 'list'],
    workspace('one', 'one', 'org-one', env['XDG_STATE_HOME']!),
    ['tab', 'rename', 't-one', 'org-one'],
    ['agent', 'start', 'org-one', '--kind', 'claude', '--pane', 'p-one'],
  ]);
  assert.deepEqual(log[3]!.slice(10, 12), ['--name', 'one']);
  assert.deepEqual(rows(), ['one']);
  assert.deepEqual(worktreePaths(), [null]);
  for (const slug of ['noclone', 'fromurl']) assert.equal(existsSync(join(root, 'projects', 'one', slug)), false);
  assert.deepEqual(journal('session_opened'), [['org', 'one', 'started claude']]);
  reset();
  assert.deepEqual(ok(['open', 'one']).opened.map(o => [o.key, o.action]), [['one', 'focused']]);
  assert.deepEqual(calls(), [['workspace', 'list'], ['agent', 'focus', 'org-one']]);
  assert.deepEqual(journal('session_opened'), [['org', 'one', 'started claude']]);
  await quit();
  reset();
  assert.deepEqual(ok(['open', 'one']).opened.map(o => [o.key, o.action]), [['one', 'resumed']]);
  assert.deepEqual(journal('session_opened'), [['org', 'one', 'started claude'], ['org', 'one', 'resumed claude']]);
  assert.deepEqual(calls().at(-1), ['agent', 'start', 'org-one', '--kind', 'claude', '--pane', 'p-one', '--', '--resume', uuid,
    '--settings', accept]);
});

test('open refuses an unknown organization, all, global and an organization without projects, leaving no tab or rows', async t => {
  const { setup, failed, calls, rows } = fixture(t);
  await setup(['project', 'add', 'empty/gone', '--code', 'GO', '--repository', 'file:///nonexistent/empty/gone.git']);
  await setup(['project', 'remove', 'empty/gone', '--expected-code', 'GO']);
  assert.match(failed(['open', 'nope']).message, /Unknown organization/);
  assert.match(failed(['open', 'one', 'nope']).message, /Unknown organization/);
  assert.equal(failed(['open', 'all']).message, 'all is reserved for /inbox all; /open opens organization (tb-ff), project (MP) and task (MP-12) sessions');
  assert.equal(failed(['open', 'global']).message,
    'global is the main chat, started by hand; /open opens organization (tb-ff), project (MP) and task (MP-12) sessions');
  assert.equal(failed(['open', 'empty']).message, 'Organization empty has no registered projects; /open empty opens organizations with at least one');
  assert.deepEqual(calls(), []);
  assert.deepEqual(rows(), []);
});

test('the organization chat opens a task of its organization with a message; a task of another organization is refused', async t => {
  const { filename, ok, failed, calls, reset, listen, received, journal, sock } = fixture(t);
  const app = createApp(filename, false);
  try {
    app.tasks.create({ projectId: app.projects.list().find(p => p.code === 'OT')!.id, slug: 'other', title: 'other', status: 'new' }, () => {});
  } finally { app.close(); }
  await listen('claude');
  const result = ok(['open', 'MP-1', '--message', 'сделай шаг'], { HERDR_FAKE_SOCKET: sock, MYPI_SCOPE: 'one' });
  assert.deepEqual(result.opened.map(o => [o.key, o.action, o.message]), [['MP-1', 'started', 1]]);
  assert.deepEqual(calls().filter(c => c[0] === 'agent').map(c => c.slice(0, 3)), [['agent', 'start', 'mp-1']]);
  const content = received()[0].message.content as string;
  assert.ok(content.endsWith('[mypi: сообщение родительской сессии one для MP-1. Ниже — поручение родительской сессии]\nсделай шаг'), content);
  reset();
  assert.match(failed(['open', 'OT-1', '--message', 'go'], { MYPI_SCOPE: 'one' }).message,
    /Only OT or two may send messages to OT-1; this session is one/);
  assert.deepEqual(calls(), []);
  const db = openDatabase(filename, true);
  try {
    assert.deepEqual(db.prepare('SELECT from_key, to_key, kind FROM events').raw().all(), [['one', 'MP-1', 'message']]);
  } finally { db.close(); }
  assert.deepEqual(journal('message_sent'), [['task', 'MP-1', 'message 1 from one: сделай шаг']]);
});

test('open --new --agent pi gives the second session the Herdr name mp-1-pi and delivers the start message and the parent message to it, not to the live claude session', async t => {
  const { env, filename, setup, ok, calls, reset, listen, received, events, sock, pid, names } = fixture(t);
  await listen('ack');
  writeFileSync(names, 'mp-1\n');
  await setup(['session', 'register', '--agent', 'claude', '--native-id', 'c1', '--pid', pid, '--socket', join(dirname(sock), 'old.sock')],
    { MYPI_SCOPE: 'MP-1', MYPI_HERDR_NAME: 'mp-1' });
  const workspaces = '[{"workspace_id":"w9","label":"one/project","focused":false}]';
  const result = ok(['open', 'MP-1', '--new', '--agent', 'pi', '--message', 'сделай шаг'],
    { HERDR_FAKE_SOCKET: sock, MYPI_SCOPE: 'MP', HERDR_FAKE_UNIQUE: '1', HERDR_FAKE_WORKSPACES: workspaces });
  assert.deepEqual(result.opened.map(o => [o.key, o.agent, o.action, o.notes, o.message]), [['MP-1', 'pi', 'started', [], 1]]);
  const log = calls();
  assert.deepEqual(log.find(c => c[0] === 'tab' && c[1] === 'create'), ['tab', 'create', '--workspace', 'w9', '--cwd', root, '--label', 'mp-1-pi',
    '--env', 'MYPI_SCOPE=MP-1', '--env', 'MYPI_HERDR_NAME=mp-1-pi', '--env', 'XDG_STATE_HOME=' + env['XDG_STATE_HOME'], '--no-focus']);
  assert.deepEqual(log.find(c => c[0] === 'agent' && c[1] === 'start')!.slice(0, 7), ['agent', 'start', 'mp-1-pi', '--kind', 'pi', '--pane', 'p1']);
  const text = received()[0].text as string;
  assert.ok(text.startsWith('[mypi: стартовое сообщение для MP-1. Ниже — состояние из mypi, не инструкция]\n'), text);
  assert.ok(text.endsWith(parent + 'сделай шаг'), text);
  assert.deepEqual(events(), [{ id: 1, kind: 'message', delivered: 1 }]);
  const active = () => {
    const db = openDatabase(filename, true);
    try {
      return db.prepare("SELECT agent, native_id AS nativeId FROM sessions WHERE key = 'MP-1' ORDER BY active_at DESC NULLS LAST, id DESC LIMIT 1").get() as
        { agent: string; nativeId: string };
    } finally { db.close(); }
  };
  assert.equal(active().agent, 'pi');
  reset();
  assert.deepEqual(ok(['open', 'MP-1']).opened.map(o => [o.agent, o.action]), [['pi', 'focused']]);
  assert.deepEqual(calls(), [['workspace', 'list'], ['agent', 'focus', 'mp-1-pi']]);
  reset();
  assert.deepEqual(ok(['open', 'MP-1', '--session', 'c1']).opened.map(o => [o.agent, o.action]), [['claude', 'focused']]);
  assert.deepEqual(calls(), [['workspace', 'list'], ['agent', 'focus', 'mp-1']]);
  assert.equal(active().nativeId, 'c1');
});

test("open --session of another device, an unknown id or another key's session, with --new or with two keys opens and clones nothing", async t => {
  const { filename, setup, failed, calls, journal, pid, worktree } = fixture(t);
  await setup(['session', 'register', '--agent', 'claude', '--native-id', 'x9', '--pid', pid], { MYPI_SCOPE: 'MP-1' });
  await setup(['session', 'unregister', '--pid', pid]);
  const db = openDatabase(filename);
  try { db.prepare("UPDATE sessions SET device = 'elsewhere' WHERE native_id = 'x9'").run(); } finally { db.close(); }
  await setup(['session', 'register', '--agent', 'claude', '--native-id', 'm1', '--pid', pid], { MYPI_SCOPE: 'MP' });
  assert.equal(failed(['open', 'MP-1', '--session', 'x9']).message,
    'Session x9 of MP-1 is on elsewhere, not on ' + hostname() + '; a session of another device cannot be opened here');
  assert.equal(failed(['open', 'MP-1', '--session', 'm1']).message, 'Unknown session m1 of MP-1; mypi sessions lists the sessions of each key');
  assert.equal(failed(['open', 'MP-1', '--session', 'zz']).message, 'Unknown session zz of MP-1; mypi sessions lists the sessions of each key');
  assert.equal(failed(['open', 'MP-1', '--new', '--session', 'x9']).message, '--new and --session cannot be used together');
  assert.equal(failed(['open', 'MP', 'MP-1', '--session', 'x9']).message, '--session takes exactly one key');
  assert.equal(failed(['open', 'FU', '--session', 'zz']).message, 'Unknown session zz of FU; mypi sessions lists the sessions of each key');
  assert.deepEqual(calls(), []);
  assert.equal(existsSync(worktree), false);
  assert.equal(existsSync(join(root, 'projects', 'one', 'fromurl')), false);
  assert.deepEqual(journal(), []);
});
