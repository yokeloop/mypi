import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, resolveStatePath } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';

const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const accept = '{"crossSessionInbound":"accept"}';

const herdr = `#!/usr/bin/bash
(IFS=$'\\037'; printf '%s\\n' "$*") >> "$HERDR_LOG"
if [ "\${HERDR_FAKE:-}" = down ]; then echo '{"error":{"code":"server_not_running","message":"server is not running"}}'; exit 1; fi
case "$1 $2" in
  'workspace list') echo "{\\"result\\":{\\"type\\":\\"workspace_list\\",\\"workspaces\\":\${HERDR_FAKE_WORKSPACES:-[]}}}" ;;
  'workspace create') echo '{"result":{"workspace":{"workspace_id":"w-new","label":"mypi"}}}' ;;
  'tab create')
    label=; previous=
    for arg in "$@"; do [ "$previous" = --label ] && label="$arg"; previous="$arg"; done
    if [ -n "\${HERDR_FAKE_TAB_FAIL:-}" ] && [ "$label" = "$HERDR_FAKE_TAB_FAIL" ]; then echo '{"error":{"code":"tab_failed","message":"boom"}}'; exit 1; fi
    echo '{"result":{"tab":{"tab_id":"t1","workspace_id":"w1"},"root_pane":{"pane_id":"p1"}}}' ;;
  'agent start') echo "{\\"type\\":\\"agent_started\\",\\"name\\":\\"$3\\",\\"pane_id\\":\\"p1\\"}" ;;
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
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'), runtime = join(dir, 'run'), log = join(dir, 'herdr.log');
  mkdirSync(bin);
  mkdirSync(runtime, { mode: 0o700 });
  writeFileSync(join(bin, 'herdr'), herdr, { mode: 0o755 });
  const env: Record<string, string> = { PATH: bin + ':/work/tools:/usr/bin', HOME: dir, XDG_STATE_HOME: join(dir, 'state'),
    XDG_RUNTIME_DIR: runtime, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HERDR_LOG: log };
  const cli = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const ok = (args: string[], extra: Record<string, string> = {}) => {
    const result = cli(args, extra);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as { opened: { key: string; agent: string; action: string; worktreePath: string | null; notes: string[] }[] };
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
  assert.equal(cli(['db', 'init']).status, 0);
  const filename = resolveStatePath(env, dir);
  const app = createApp(filename, false);
  try {
    const projectId = app.projects.add('one/project', 'MP', clone).id;
    app.projects.add('one/noclone', 'NC');
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
  const pid = String(process.pid);
  return { env, cli, ok, failed, calls, reset, rows, worktreePaths, pid, worktree: realpathSync(clone) + '--MP-1-open' };
}

const tab = (workspace: string, label: string, key: string, state: string) =>
  ['tab', 'create', '--workspace', workspace, '--cwd', root, '--label', label, '--env', 'MYPI_SCOPE=' + key, '--env', 'XDG_STATE_HOME=' + state, '--no-focus'];

test("open starts new Claude sessions in no-focus tabs of the caller's workspace and creates the task worktree", t => {
  const { env, ok, calls, rows, worktree } = fixture(t);
  const result = ok(['open', 'MP', 'MP-1'], { HERDR_WORKSPACE_ID: 'w1' });
  assert.deepEqual(result.opened.map(o => [o.key, o.agent, o.action, o.worktreePath]),
    [['MP', 'claude', 'started', null], ['MP-1', 'claude', 'started', worktree]]);
  assert.ok(existsSync(worktree));
  const log = calls();
  const uuids = [log[2]![9]!, log[4]![9]!];
  for (const uuid of uuids) assert.match(uuid, /^[0-9a-f-]{36}$/);
  assert.notEqual(uuids[0], uuids[1]);
  assert.deepEqual(log, [
    ['workspace', 'list'],
    tab('w1', 'mp', 'MP', env['XDG_STATE_HOME']!),
    ['agent', 'start', 'mp', '--kind', 'claude', '--pane', 'p1', '--', '--session-id', uuids[0]!, '--name', 'MP', '--settings', accept],
    tab('w1', 'mp-1', 'MP-1', env['XDG_STATE_HOME']!),
    ['agent', 'start', 'mp-1', '--kind', 'claude', '--pane', 'p1', '--', '--session-id', uuids[1]!, '--name', 'MP-1', '--settings', accept],
  ]);
  assert.deepEqual(rows(), []);
});

test('open picks the mypi workspace and creates it once when missing', t => {
  const { env, ok, calls, reset } = fixture(t);
  ok(['open', 'MP'], { HERDR_FAKE_WORKSPACES: '[{"workspace_id":"w9","label":"mypi","focused":false}]' });
  assert.deepEqual(calls().slice(0, 2), [['workspace', 'list'], tab('w9', 'mp', 'MP', env['XDG_STATE_HOME']!)]);
  assert.ok(!calls().some(c => c[0] === 'workspace' && c[1] === 'create'));
  reset();
  ok(['open', 'MP']);
  assert.deepEqual(calls().slice(0, 3), [['workspace', 'list'], ['workspace', 'create', '--cwd', root, '--label', 'mypi', '--no-focus'],
    tab('w-new', 'mp', 'MP', env['XDG_STATE_HOME']!)]);
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
  assert.deepEqual(calls().at(-1), ['agent', 'start', 'mp-1', '--kind', 'claude', '--pane', 'p1', '--', '--resume', 'c1', '--permission-mode', 'plan',
    '--settings', accept]);
  reset();
  assert.equal(cli(['session', 'register', '--agent', 'pi', '--native-id', 'p9', '--pid', pid], { MYPI_SCOPE: 'MP' }).status, 0);
  assert.equal(cli(['session', 'unregister', '--pid', pid]).status, 0);
  const pi = ok(['open', 'MP', '--permission-mode', 'auto']);
  assert.deepEqual(pi.opened.map(o => [o.key, o.agent, o.action, o.notes]), [['MP', 'pi', 'resumed', ['Pi has no permission mode; auto was not passed to MP']]]);
  assert.deepEqual(calls().at(-1), ['agent', 'start', 'mp', '--kind', 'pi', '--pane', 'p1', '--', '--session-id', 'p9']);
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
