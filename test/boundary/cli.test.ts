import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nativeOpeningFailure } from '../../src/app/native-opening-cli.js';
import { ObservedSessionConflict } from '../../src/app/pi-terminal.js';
import { HerdrPartialError } from '../../src/app/herdr.js';

test('Node opening serializes real conflict and partial classes with exact known handles', () => {
  const conflicts = [{ instanceKey: 'one', status: 'stale' as const }];
  const observed = nativeOpeningFailure(new ObservedSessionConflict(conflicts));
  assert.deepEqual(observed.ok ? null : observed.error.conflicts, conflicts);
  assert.equal(observed.ok ? null : observed.error.state, 'observed-conflict');
  const partial = nativeOpeningFailure(new HerdrPartialError('submit', '/run/herdr.sock', 'tab1', 'pane1'));
  assert.deepEqual(partial.ok ? null : partial.error, {
    state: 'partial', message: 'Herdr operation may have taken effect. Inspect the explicit server/known IDs before choosing another action; do not blindly retry.',
    stage: 'submit', herdrSocketPath: '/run/herdr.sock', tabId: 'tab1', paneId: 'pane1',
  });
});

test('Node native opening uses captured installation and rejects changed binding before selection', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-native-opening-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const engineRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
  const binding = join(dir, 'binding.json');
  const selected = { version: 1, engineRoot, homeRoot: join(dir, 'home'), database: join(dir, 'data.sqlite3'),
    stateRoot: join(dir, 'state') };
  writeFileSync(binding, JSON.stringify(selected));
  const env = { ...process.env, MYPI_INSTALLATION_FILE: binding, MYPI_SESSION_DIR: join(dir, 'state', 'sessions'),
    MYPI_MAILBOX_DIR: join(dir, 'state', 'mailbox'), HOME: dir };
  const run = (...args: string[]) => spawnSync(process.execPath, [entry, ...args],
    { env, cwd: dir, encoding: 'utf8', timeout: 5000 });
  const initialized = run('db', 'init');
  assert.ifError(initialized.error);
  assert.equal(initialized.status, 0, initialized.stderr);
  const checkout = join(dir, 'checkout');
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: dir, env: { ...env, GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--quiet', '-b', 'main', checkout);
  git('-C', checkout, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'fixture');
  const added = run('project', 'add', 'one/app', '--code', 'APP', '--path', checkout);
  assert.ifError(added.error);
  assert.equal(added.status, 0, added.stderr);
  const snapshot = { ...selected, configPath: binding, sessionDirectory: env.MYPI_SESSION_DIR,
    mailboxDirectory: env.MYPI_MAILBOX_DIR };
  const open = (installation: typeof snapshot) => run('project', 'open-native', JSON.stringify({ installation, callerCwd: dir }));
  const choices = open(snapshot);
  assert.equal(choices.status, 0, choices.stderr);
  assert.deepEqual(JSON.parse(choices.stdout).value.projects, ['one/app']);
  assert.deepEqual(JSON.parse(choices.stdout).value.organizations, ['one']);
  const list = run('project', 'open-native', JSON.stringify({ installation: snapshot, callerCwd: dir,
    action: 'list', project: 'one/app', worktree: checkout }));
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).value.state, 'selected', 'valid checkout listing must return without launching');
  const invalidTree = run('project', 'open-native', JSON.stringify({ installation: snapshot, callerCwd: dir,
    action: 'list', project: 'one/app', worktree: dir }));
  assert.equal(JSON.parse(invalidTree.stdout).ok, false);
  const org = run('project', 'open-native', JSON.stringify({ installation: snapshot, callerCwd: dir, organization: 'one' }));
  assert.deepEqual(JSON.parse(org.stdout).value, { state: 'organization', organization: 'one' });
  const invalid = run('project', 'open-native', JSON.stringify({ installation: snapshot, callerCwd: dir, action: 'open' }));
  assert.match(JSON.parse(invalid.stdout).error.message, /requires an organization or project/);
  const refused = open({ ...snapshot, database: join(dir, 'other.sqlite3') });
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(JSON.parse(refused.stdout).error.message, /Installation changed/);
  assert.equal(existsSync(join(dir, 'other.sqlite3')), false);
});

test('real Node launcher persists projects across independent processes without Python or context writes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const binding = join(dir, 'binding.json');
  writeFileSync(binding, JSON.stringify({ version: 1, engineRoot: '/work', homeRoot: join(dir, 'home'),
    database: join(dir, 'state/mypi/state.sqlite3'), stateRoot: join(dir, 'state/mypi') }));
  const env = { PATH: '/work/tools', HOME: dir, MYPI_PI_CONTEXT: 'malformed-fresh-launch-handoff',
    MYPI_INSTALLATION_FILE: binding, XDG_STATE_HOME: join(dir, 'state') };
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env, cwd: dir, encoding: 'utf8', timeout: 3000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const messages = run('message', 'list', 'offline-native-id');
  assert.equal(messages.status, 0, messages.stderr);
  assert.deepEqual(JSON.parse(messages.stdout), { messages: [], issues: [], truncated: false });
  const sessions = run('session', 'list', '--all');
  assert.equal(sessions.status, 0, sessions.stderr);
  assert.deepEqual(JSON.parse(sessions.stdout), { sessions: [], issues: [], truncated: false });
  const missingControl = run('session', 'focus', '11111111-1111-4111-8111-111111111111', '--all');
  assert.equal(missingControl.status, 1);
  assert.deepEqual(JSON.parse(missingControl.stderr), { status: 'error', message: 'Cannot control session observation: missing' });
  assert.equal(missingControl.stdout, '');
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
