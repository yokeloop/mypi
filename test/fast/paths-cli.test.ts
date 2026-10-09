import { controlHerdrSession, herdrPiCommand, HerdrPartialError, openHerdrPi } from '../../src/app/herdr.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeState, createApp } from '../../src/app/create-app.js';
import { databasePath, externalDatabasePath } from '../../src/infrastructure/filesystem/paths.js';
import { parseCommand } from '../../src/cli/command.js';
import { preparePiLaunch, piLaunchObservations } from '../../src/app/pi-launcher.js';
import { state } from '../support/state.js';

test('XDG/default state paths stay outside engine and context, including symlink aliases', t => {
  const { dir } = state(t);
  const engine = join(dir, 'engine');
  const home = join(dir, 'personal');
  mkdirSync(engine);
  assert.equal(databasePath({}, home, engine), join(home, '.local/state/mypi/state.sqlite3'));
  assert.equal(databasePath({ XDG_STATE_HOME: join(dir, 'state') }, home, engine), join(dir, 'state/mypi/state.sqlite3'));
  assert.throws(() => databasePath({ XDG_STATE_HOME: 'relative' }, home, engine), /absolute/);
  assert.throws(() => databasePath({ XDG_STATE_HOME: join(engine, 'home') }, home, engine), /outside/);
  const alias = join(dir, 'alias');
  symlinkSync(engine, alias);
  assert.throws(() => databasePath({ XDG_STATE_HOME: alias }, home, engine), /outside/);
  const dangling = join(dir, 'dangling.sqlite3');
  symlinkSync(join(engine, 'not-created.sqlite3'), dangling);
  assert.throws(() => externalDatabasePath(dangling, engine), /symlink|outside/i);
  assert.equal(externalDatabasePath(join(dir, 'new.sqlite3'), engine), join(dir, 'new.sqlite3'));
  const forbidden = fileURLToPath(new URL('../../../forbidden.sqlite3', import.meta.url));
  assert.throws(() => initializeState(forbidden), /outside/);
  assert.throws(() => createApp(forbidden, true), /outside/);
});

test('Pi launcher arguments keep selection exclusive and native arguments opaque', () => {
  assert.deepEqual(parseCommand(['pi', '--herdr-tab', '--title', 'two chats', '--allow-observed-session', '--', '--resume']), {
    type: 'pi', herdrTab: true, title: 'two chats', allowObservedSession: true, args: ['--resume'],
  });
  assert.deepEqual(parseCommand(['session', 'focus', 'key', '--all']), { type: 'session-control', action: 'focus', instanceKey: 'key', all: true });
  assert.deepEqual(parseCommand(['session', 'title', 'key', 'new title', '--project', 'one/project']), {
    type: 'session-control', action: 'title', instanceKey: 'key', title: 'new title', project: 'one/project',
  });
  for (const args of [['session', 'title', 'key'], ['session', 'focus', 'key', '--all', '--project', 'one/project'],
    ['session', 'focus', 'key', '--all', '--all']]) assert.throws(() => parseCommand(args));
  assert.deepEqual(parseCommand(['pi']), { type: 'pi', args: [] });
  assert.deepEqual(parseCommand(['pi', '--project', 'one/project', '--base', '/clone', '--cwd', '/task', '--', '--session', 'a b', '--', '-prompt']), {
    type: 'pi', selection: { kind: 'project', project: 'one/project' }, base: '/clone', cwd: '/task', args: ['--session', 'a b', '--', '-prompt'],
  });
  assert.deepEqual(parseCommand(['pi', '--org=one']), { type: 'pi', selection: { kind: 'organization', organization: 'one' }, args: [] });
  assert.deepEqual(parseCommand(['pi', '--unrestricted', '--', '--help']), { type: 'pi', selection: { kind: 'unrestricted' }, args: ['--help'] });
  for (const args of [
    ['--project', 'one/project', '--org', 'one'], ['--project', 'one/project', '--unrestricted'],
    ['--org', 'one', '--unrestricted'], ['--project', 'one/project', '--project', 'two/project'],
    ['--cwd', '/a', '--cwd=/b'], ['--unrestricted', '--unrestricted'], ['--org', ''],
    ['--title', 'not-an-explicit-tab'], ['--herdr-tab', '--herdr-tab'],
    ['--base', '/clone'], ['--project'], ['--help'], ['--unknown'], ['prompt'],
  ]) assert.throws(() => parseCommand(['pi', ...args]));
});

test('Pi unselected/unrestricted need no registry; organization resolves read-only without repository inspection', t => {
  const { dir, filename } = state(t);
  const cwd = join(dir, 'cwd');
  mkdirSync(cwd);
  const alias = join(dir, 'alias');
  symlinkSync(cwd, alias);
  const app = createApp(filename, false);
  app.projects.add('one/project', 'MP');
  app.close();
  const readonly = createApp(filename, true);
  t.after(() => readonly.close());
  const registry = { projects: readonly.projects, repositories: { verify(): never { throw new Error('Unexpected repository inspection'); } } };
  const aliasCard = { version: 1 as const, instanceKey: 'alias-observation', nativeSessionId: 'native', cwd: alias,
    state: 'idle' as const, startedAt: 0, lastSeen: 0 };
  const aliasInventory = { sessions: [{ card: aliasCard, status: 'idle' as const, ageMs: 0, archived: false }], issues: [], truncated: false };
  assert.deepEqual(piLaunchObservations(cwd, aliasInventory), {
    conflicts: [{ instanceKey: 'alias-observation', status: 'idle' }], requiresChoice: true, incomplete: false,
  });
  assert.deepEqual(piLaunchObservations(cwd, { ...aliasInventory, sessions: [{ ...aliasInventory.sessions[0]!,
    card: { ...aliasCard, cwd: join(dir, 'removed-directory') } }] }), { conflicts: [], requiresChoice: false, incomplete: true });
  const before = readdirSync(dir);
  assert.deepEqual(preparePiLaunch({ args: [] }, alias), { cwd, args: [] });
  assert.deepEqual(preparePiLaunch({ selection: { kind: 'unrestricted' }, args: ['--help'] }, alias), {
    cwd, args: ['--help'], context: { version: 1, cwd, context: { scope: { kind: 'unrestricted' } } },
  });
  assert.deepEqual(preparePiLaunch({ selection: { kind: 'organization', organization: 'one' }, cwd: alias, args: [] }, dir, registry), {
    cwd, args: [], context: { version: 1, cwd, context: { scope: { kind: 'organization', organization: 'one' } } },
  });
  assert.throws(() => preparePiLaunch({ selection: { kind: 'organization', organization: 'missing' }, args: [] }, cwd, registry), /Unknown organization/);
  assert.throws(() => preparePiLaunch({ selection: { kind: 'project', project: 'one/missing' }, args: [] }, cwd, registry), /Unknown project/);
  assert.throws(() => preparePiLaunch({ selection: { kind: 'project', project: 'one/project' }, args: [] }, cwd, registry), /no checkout/);
  assert.throws(() => preparePiLaunch({ cwd: filename, args: [] }, dir), /directory/);
  assert.throws(() => preparePiLaunch({ cwd: join(dir, 'missing'), args: [] }, dir));
  assert.deepEqual(readdirSync(dir), before);
});

test('CLI parsing is strict without invoking a process for the validation matrix', () => {
  assert.deepEqual(parseCommand(['project', 'add', 'one/project', '--code', 'MP']), {
    type: 'add', identity: 'one/project', code: 'MP',
  });
  assert.deepEqual(parseCommand(['project', 'list', '--org', 'one']), { type: 'list', org: 'one' });
  assert.deepEqual(parseCommand(['db', 'init']), { type: 'initialize' });
  assert.deepEqual(parseCommand(['--help']), { type: 'help' });
  const parsed = parseCommand(['request', 'create', 'exact source', '--project', 'one/project', '--title', 'Title', '--slug', 'slug', '--status', 'planning']);
  assert.equal(parsed.type, 'workspace');
  if (parsed.type === 'workspace') {
    assert.equal(parsed.name, 'request create'); assert.deepEqual(parsed.args, ['exact source']);
    assert.deepEqual({ ...parsed.options }, { project: 'one/project', title: 'Title', slug: 'slug', status: 'planning' });
  }
  for (const args of [
    ['bootstrap'], ['capture', '--file', 'source'], ['warmup', '-s', 'one/project'],
    ['policy', 'validate', '--file', 'policy.yaml'],
    ['policy', 'explain', 'outsideWorktreeWrite'],
    ['policy', 'explain', 'baseCheckoutWrite', 'version: 2'],
    ['policy', 'explain', 'foreignMypiTarget', '--file', 'policy.yaml'],
    ['note', 'title', 'text'], ['error', 'one/project', 'error'],
    ['memory', 'show'], ['memory', 'add', 'fact'], ['memory', 'remove', '1'],
    ['journal', 'add', 'outcome'], ['journal', 'read', '--all'],
    ['request', 'create', 'source'], ['request', 'list'], ['request', 'show', 'REQ-1'],
    ['request', 'title', 'REQ-1', 'title'], ['request', 'status', 'REQ-1', 'new'],
    ['request', 'progress', 'REQ-1', 'progress'], ['request', 'touch', 'REQ-1'],
    ['status', 'list'], ['status', 'add', 'custom'], ['status', 'rename', 'a', 'b'],
    ['status', 'terminal', 'a', 'true'], ['status', 'remove', 'a'],
    ['context', 'read', 'MEMORY.md'], ['context', 'commit', 'MEMORY.md'],
    ['context', 'restore', 'MEMORY.md'], ['backup', '/tmp/backup'], ['restore', '/tmp/backup'],
  ]) assert.equal(parseCommand(args).type, 'workspace');
  for (const args of [
    ['project', 'add', 'one/project'],
    ['project', 'add', 'one/project', 'extra', '--code', 'MP'],
    ['project', 'list', 'extra'],
    ['project', 'list', '--unknown'],
    ['db', 'init', 'extra'],
    ['unknown'],
    ['policy', 'explain', 'baseCheckoutWrite', '--principal', 'operator'],
    ['policy', 'preview', 'baseCheckoutWrite'],
    ['policy', 'explain', 'baseCheckoutWrite', '--target', '{"kind":"global"}'],
    ['policy', 'explain'],
    ['policy', 'explain', 'baseCheckoutWrite', 'version: 2', 'extra'],
    ['import', 'legacy', '/tmp/archive', '--codes', '/tmp/codes.json'],
  ]) assert.throws(() => parseCommand(args));
});

test('Pi launch advice requires explicit choice for archived/fresh/stale observations without claiming exclusion', () => {
  const card = { version: 1 as const, instanceKey: 'observed', nativeSessionId: 'native', cwd: '/task',
    state: 'idle' as const, startedAt: 0, lastSeen: 0 };
  const identity = (path: string) => path;
  for (const status of ['starting', 'running', 'idle', 'stale', 'unknown'] as const) {
    const inventory = { sessions: [{ card, status, ageMs: null, archived: true }], issues: [], truncated: false };
    assert.deepEqual(piLaunchObservations('/task', inventory, false, identity), {
      conflicts: [{ instanceKey: 'observed', status }], requiresChoice: true, incomplete: false,
    });
    assert.equal(piLaunchObservations('/task', inventory, true, identity).requiresChoice, false);
    assert.deepEqual(piLaunchObservations('/independent', inventory, false, identity), { conflicts: [], requiresChoice: false, incomplete: false });
    assert.equal(piLaunchObservations('/task', { ...inventory, sessions: [{ ...inventory.sessions[0]!, card: { ...card, state: 'closed' } }] }, false, identity).requiresChoice, false);
  }
  for (const inventory of [
    { sessions: [], issues: [{ issue: 'invalid' as const }], truncated: false },
    { sessions: [], issues: [], truncated: true },
  ]) assert.deepEqual(piLaunchObservations('/task', inventory, false, identity), { conflicts: [], requiresChoice: false, incomplete: true });
  const subdirectory = { ...card, cwd: '/task/sub', context: { scope: { kind: 'project' as const, project: 'one/project' }, worktreeRoot: '/task' } };
  assert.equal(piLaunchObservations('/task', { sessions: [{ card: subdirectory, status: 'idle', ageMs: 0, archived: false }], issues: [], truncated: false }, false, identity).requiresChoice, true);
});

test('Herdr explicit caller/target mappings preserve namespace, cross-workspace selection and partial acknowledgements', () => {
  const env = { HERDR_ENV: '1', HERDR_SOCKET_PATH: '/run/disposable.sock', HERDR_PANE_ID: 'caller-pane',
    HERDR_TAB_ID: 'caller-tab', HERDR_WORKSPACE_ID: 'caller-workspace', PATH: '/bin', HOME: '/home/disposable' };
  const caller = { pane_id: 'caller-pane', tab_id: 'caller-tab', workspace_id: 'caller-workspace' };
  const target = { pane_id: 'target-pane', tab_id: 'target-tab', workspace_id: 'other-workspace' };
  const card = { version: 1 as const, instanceKey: 'observed', nativeSessionId: 'native', cwd: '/task',
    state: 'idle' as const, startedAt: 0, lastSeen: 0, herdrSocketPath: env.HERDR_SOCKET_PATH,
    herdrPaneId: 'target-pane', herdrTabId: 'target-tab' };
  const cards = { show: () => ({ session: { card, status: 'idle' as const, ageMs: 0, archived: false } }) };
  function runner(responses: unknown[]) {
    // Mutable local recorder; no process/network adapter is imported in this profile.
    const recorded: string[][] = [];
    return { calls: recorded, run(args: readonly string[]) { recorded.push([...args]);
      assert(responses.length, 'unexpected extra Herdr request');
      const response = responses.shift();
      return { code: 0 as const, stdout: typeof response === 'string' ? response : JSON.stringify({ result: response }) };  } };
  }
  for (const action of ['focus', 'title'] as const) {
    const fake = runner([{ type: 'pane_current', pane: caller }, { type: 'pane_current', pane: target },
      { type: 'tab_info', tab: target }, { type: 'tab_info', tab: {
        agent_status: 'unknown', focused: action === 'focus', label: '-explicit title', number: 6,
        pane_count: 1, tab_id: 'target-tab', workspace_id: 'other-workspace',
      } }]);
    assert.deepEqual(controlHerdrSession({ action, instanceKey: 'observed', all: true, title: '-explicit title' }, env, fake.run, cards),
      { status: action === 'focus' ? 'focused' : 'renamed', instanceKey: 'observed', tabId: 'target-tab' });
    assert.deepEqual(fake.calls, [['pane', 'current', '--current'], ['pane', 'current', '--pane', 'target-pane'],
      ['tab', 'get', 'target-tab'], action === 'focus' ? ['tab', 'focus', 'target-tab'] : ['tab', 'rename', 'target-tab', '-explicit title']]);
  }
  const command = { action: 'focus' as const, instanceKey: 'observed', all: true };
  const noCalls = runner([]);
  assert.throws(() => controlHerdrSession(command, {}, noCalls.run, cards), /caller context/);
  assert.equal(noCalls.calls.length, 0);
  const wrongNamespace = runner([{ type: 'pane_current', pane: caller }]);
  assert.throws(() => controlHerdrSession(command, { ...env, HERDR_SOCKET_PATH: '/other.sock' }, wrongNamespace.run, cards), /socket/);
  assert.equal(wrongNamespace.calls.length, 1);
  const moved = runner([{ type: 'pane_current', pane: target }]);
  assert.throws(() => controlHerdrSession(command, env, moved.run, cards), /refresh/);
  const mismatched = runner([{ type: 'pane_current', pane: caller }, { type: 'pane_current', pane: target },
    { type: 'tab_info', tab: { ...target, workspace_id: 'wrong' } }]);
  assert.throws(() => controlHerdrSession(command, env, mismatched.run, cards), /association/);
  assert.equal(mismatched.calls.length, 3, 'mismatched target cannot be focused');
  for (const [action, receipt] of [
    ['focus', { type: 'ok' }],
    ['focus', { type: 'tab_focused', tab_id: 'target-tab', workspace_id: 'other-workspace' }],
    ['title', { type: 'tab_renamed', tab_id: 'target-tab', workspace_id: 'other-workspace', label: '-explicit title' }],
    ['focus', { type: 'tab_info', tab: { tab_id: 'wrong-tab', workspace_id: 'other-workspace' } }],
    ['focus', { type: 'tab_info', tab: { tab_id: 'target-tab', workspace_id: 'wrong-workspace' } }],
    ['title', { type: 'tab_info', tab: { tab_id: 'target-tab', workspace_id: 'other-workspace', label: 'wrong title' } }],
  ] as const) {
    const uncertain = runner([{ type: 'pane_current', pane: caller }, { type: 'pane_current', pane: target },
      { type: 'tab_info', tab: target }, receipt]);
    assert.throws(() => controlHerdrSession({ action, instanceKey: 'observed', all: true, title: '-explicit title' }, env, uncertain.run, cards),
      error => error instanceof HerdrPartialError && error.stage === action && error.herdrSocketPath === '/run/disposable.sock'
        && error.tabId === 'target-tab' && error.paneId === 'target-pane');
    assert.equal(uncertain.calls.length, 4, 'unconfirmed control preserves known IDs without retry');
  }

  const createdTab = { tab_id: 'returned-tab', workspace_id: 'caller-workspace' };
  const createdPane = { ...createdTab, pane_id: 'returned-pane' };
  const plan = { cwd: '/task', args: ['--resume'] };
  const opened = runner([{ type: 'pane_current', pane: caller }, { type: 'tab_created', tab: createdTab, root_pane: createdPane }, '']);
  assert.deepEqual(openHerdrPi(plan, '/bin/pi', '/pkg/mypi.ts', env, opened.run, 'explicit'), {
    status: 'submitted', herdrSocketPath: '/run/disposable.sock', tabId: 'returned-tab', paneId: 'returned-pane',
  });
  assert.deepEqual(opened.calls[1], ['tab', 'create', '--workspace', 'caller-workspace', '--cwd', '/task', '--no-focus', '--label', 'explicit']);
  assert.deepEqual(opened.calls[2]!.slice(0, 3), ['pane', 'run', 'returned-pane']);
  assert.match(opened.calls[2]![3]!, /'\/bin\/pi' '--extension' '\/pkg\/mypi.ts' '--resume'$/);
  const malformed = runner([{ type: 'pane_current', pane: caller }, { type: 'unknown' }]);
  assert.throws(() => openHerdrPi(plan, '/bin/pi', '/pkg/mypi.ts', env, malformed.run),
    error => error instanceof HerdrPartialError && error.stage === 'create' && error.tabId === undefined);
  assert.equal(malformed.calls.length, 2, 'no retry after uncertain create');
  const failedSubmit = runner([{ type: 'pane_current', pane: caller }, { type: 'tab_created', tab: createdTab, root_pane: createdPane }, {}]);
  assert.throws(() => openHerdrPi(plan, '/bin/pi', '/pkg/mypi.ts', env, failedSubmit.run),
    error => error instanceof HerdrPartialError && error.stage === 'submit' && error.tabId === 'returned-tab' && error.paneId === 'returned-pane');
  assert.equal(failedSubmit.calls.length, 3, 'no deletion or retry after uncertain submission');
  for (const unexpected of ['\n', '{not JSON', JSON.stringify({ result: { type: 'ok' } })]) {
    const receipt = runner([{ type: 'pane_current', pane: caller }, { type: 'tab_created', tab: createdTab, root_pane: createdPane }, unexpected]);
    assert.throws(() => openHerdrPi(plan, '/bin/pi', '/pkg/mypi.ts', env, receipt.run),
      error => error instanceof HerdrPartialError && error.stage === 'submit');
    assert.equal(receipt.calls.length, 3);
  }
  const emptyCreate = runner([{ type: 'pane_current', pane: caller }, '']);
  assert.throws(() => openHerdrPi(plan, '/bin/pi', '/pkg/mypi.ts', env, emptyCreate.run),
    error => error instanceof HerdrPartialError && error.stage === 'create');
  const invalidJson = runner(['raw-output-must-not-leak']);
  assert.throws(() => controlHerdrSession(command, env, invalidJson.run, cards), { message: 'Invalid Herdr JSON acknowledgement' });
});

test('Herdr shell transport quotes opaque tokens and explicitly clears absent working-context environment', () => {
  const text = herdrPiCommand({ cwd: '/task', args: ["a'b", '$(touch /no)', 'line\nbreak', ''] },
    '/opt/pi', '/pkg/my pi.ts', { HOME: '/home/disposable', MYPI_GUARD_POLICY: '/data/policy with space',
      MYPI_PI_CONTEXT: 'must-not-leak', MYPI_MCP_CONTEXT: 'must-not-leak', MYPI_MCP_NATIVE_SESSION_ID: 'must-not-leak',
      MYPI_MAILBOX_DIR: '/runtime/mailbox', MYPI_MAILBOX_RECEIVE: '1', MYPI_MAILBOX_POLL_MS: '2000',
      HERDR_PANE_ID: 'old-pane', PROVIDER_SECRET: 'must-not-leak' });
  assert.equal(text, "cd '/task' && '/usr/bin/env' '-u' 'PATH' '-u' 'HOME' '-u' 'XDG_CONFIG_HOME' '-u' 'XDG_CACHE_HOME' '-u' 'XDG_STATE_HOME' '-u' 'XDG_DATA_HOME' '-u' 'PI_CODING_AGENT_DIR' '-u' 'MYPI_SESSION_DIR' '-u' 'MYPI_SESSION_CARDS' '-u' 'MYPI_SESSION_HEARTBEAT_MS' '-u' 'MYPI_MAILBOX_DIR' '-u' 'MYPI_MAILBOX_RECEIVE' '-u' 'MYPI_MAILBOX_POLL_MS' '-u' 'MYPI_GUARD_POLICY' '-u' 'MYPI_PI_CONTEXT' '-u' 'MYPI_MCP_CONTEXT' '-u' 'MYPI_MCP_NATIVE_SESSION_ID' 'HOME=/home/disposable' 'MYPI_MAILBOX_DIR=/runtime/mailbox' 'MYPI_MAILBOX_RECEIVE=1' 'MYPI_MAILBOX_POLL_MS=2000' 'MYPI_GUARD_POLICY=/data/policy with space' '/opt/pi' '--extension' '/pkg/my pi.ts' 'a'\\''b' '$(touch /no)' 'line\nbreak' ''");
  const context = herdrPiCommand({ cwd: '/x', args: [], context: { version: 1, cwd: '/x', context: { scope: { kind: 'unrestricted' } } } }, '/opt/pi', '/pkg/mypi.ts', {});
  assert.match(context, /'MYPI_PI_CONTEXT=eyJ2ZXJzaW9uIjoxLCJjd2QiOiIveCIsImNvbnRleHQiOnsic2NvcGUiOnsia2luZCI6InVucmVzdHJpY3RlZCJ9fX0'/);
  assert.throws(() => herdrPiCommand({ cwd: '/x', args: ['\0'] }, '/opt/pi', '/pkg/mypi.ts', {}), /NUL/);
});
