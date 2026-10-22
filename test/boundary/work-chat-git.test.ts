import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeChatRuntime } from '../../src/app/native-chat-runtime.js';
import type { WorkChat } from '../../src/modules/work-chats/public.js';

test('native runtime uses real Git common-dir/worktree registration, not directory names', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-chat-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'clone'), worktree = join(dir, 'task'), foreign = join(dir, 'foreign');
  mkdirSync(source); mkdirSync(foreign);
  function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
  }
  git(source, 'init', '-q'); git(source, 'config', 'user.name', 'Tester'); git(source, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(source, 'tracked'), 'initial'); git(source, 'add', 'tracked'); git(source, 'commit', '-qm', 'initial');
  git(source, 'worktree', 'add', '-qb', 'task/one', worktree);
  git(foreign, 'init', '-q');
  for (const name of ['state', 'agent', 'engine']) mkdirSync(join(dir, name));
  mkdirSync(join(dir, 'engine', 'dist', 'src', 'app'), { recursive: true });
  writeFileSync(join(dir, 'engine', 'dist', 'src', 'app', 'startup-extension.js'), 'fixture');
  writeFileSync(join(dir, 'USER-INSTRUCTIONS.md'), 'fixture');
  writeFileSync(join(dir, 'agent', 'settings.json'), JSON.stringify({ packages: [join(dir, 'engine', 'integrations', 'pi')] }));
  let scope = 'team/tool';
  const options = { pi: process.execPath, nodePath: process.execPath,
    installation: join(dir, 'engine'), statePath: join(dir, 'state'), userHome: dir,
    agentDir: join(dir, 'agent'), identity: () => scope };
  const runtime = nativeChatRuntime(options);
  const args = { sourceClone: source, worktree, installation: join(dir, 'engine'), statePath: join(dir, 'state') };
  const checked = await runtime.validate(args);
  assert.equal(checked.branch, 'task/one');
  assert.equal(checked.worktree, worktree);
  writeFileSync(join(dir, 'agent', 'settings.json'), JSON.stringify({ packages: ['/another/engine/integrations/pi'] }));
  await assert.rejects(runtime.validate(args), /not uniquely configured/);
  writeFileSync(join(dir, 'agent', 'settings.json'), JSON.stringify({ packages: [join(dir, 'engine', 'integrations', 'pi')] }));
  await assert.rejects(runtime.validate({ ...args, worktree: foreign }), /Foreign Git worktree|Git checkout/);
  await assert.rejects(runtime.validate({ ...args, sourceClone: join(dir, 'engine') }), /installed-engine|Git checkout/);

  // These preflight decisions must never invoke Pi's auth-filtered model catalog.
  await runtime.validateModel({ provider: 'not-authenticated', model: 'exact/model' }, { ...checked, projectId: 1, requestId: 1 });
  await assert.rejects(runtime.validateModel({ provider: '', model: 'missing-provider' }, { ...checked, projectId: 1, requestId: 1 }), /nonempty exact provider/);

  const tools = join(dir, 'tools'), response = join(dir, 'response.json'), calls = join(dir, 'calls');
  mkdirSync(tools);
  const stock = join(dir, 'stock-herdr.ts');
  writeFileSync(stock, '// installed by herdr\n// HERDR_INTEGRATION_ID=pi\n// fixture for pane.report_agent_session');
  writeFileSync(join(tools, 'herdr'), `#!/bin/sh
printf '%s %s\\n' "$1" "$2" >> "$FIXTURE_CALLS"
case "$1 $2" in
  'agent list') cat "$FIXTURE_RESPONSE" ;;
  'tab create') printf '{"result":{"root_pane":{"pane_id":"w1:p2"}}}' ;;
  'pane process-info') printf '{"error":{"code":"pane_not_found","message":"fixture"}}' >&2; exit 1 ;;
  *) exit 2 ;;
esac
`);
  chmodSync(join(tools, 'herdr'), 0o700);
  const values = { PATH: tools + ':' + process.env.PATH, HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w1',
    HERDR_SOCKET_PATH: '/tmp/fixture-herdr.sock', MYPI_WORK_CHAT_HERDR_EXTENSION: stock,
    FIXTURE_RESPONSE: response, FIXTURE_CALLS: calls };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const chat: WorkChat = { ...checked, projectId: 1, requestId: 1, id: 'chat', name: null, attemptId: 'attempt',
    sessionId: 'assigned-id', historyPath: null, pane: null, processId: null, processStart: null,
    requestedProvider: null, requestedModel: null, phase: 'reserved' };
  const launchInput = { chat, model: { source: 'unselected' as const }, resume: false, focus: false };
  const wrapper = join(dir, 'pi-wrapper');
  writeFileSync(wrapper, '#!/bin/sh\nexit 0\n');
  await assert.rejects(nativeChatRuntime({ ...options, pi: wrapper }).prepareLaunch(launchInput), /direct Linux Pi executable/);
  process.env.MYPI_WORK_CHAT_HERDR_EXTENSION = join(dir, 'missing-extension');
  await assert.rejects(runtime.prepareLaunch(launchInput), /ENOENT/);
  const wrong = join(dir, 'wrong-extension'); writeFileSync(wrong, 'not the stock integration');
  process.env.MYPI_WORK_CHAT_HERDR_EXTENSION = wrong;
  await assert.rejects(runtime.prepareLaunch(launchInput), /stock Herdr/);
  process.env.MYPI_WORK_CHAT_HERDR_EXTENSION = stock;
  process.env.HERDR_SOCKET_PATH = 'relative';
  await assert.rejects(runtime.prepareLaunch(launchInput), /local HERDR_SOCKET_PATH/);
  process.env.HERDR_SOCKET_PATH = values.HERDR_SOCKET_PATH;
  scope = 'invalid scope';
  await assert.rejects(runtime.prepareLaunch(launchInput), /Invalid registered project scope/);
  scope = 'team/tool';
  writeFileSync(join(dir, 'agent', 'settings.json'), JSON.stringify({ packages: [] }));
  await assert.rejects(runtime.prepareLaunch(launchInput), /not uniquely configured/);
  writeFileSync(join(dir, 'agent', 'settings.json'), JSON.stringify({ packages: [join(dir, 'engine', 'integrations', 'pi')] }));
  assert.equal(existsSync(calls), false, 'deterministic failures perform no Herdr calls');
  writeFileSync(response, '{"result":{"agents":[]}}');
  const prepared = await runtime.prepareLaunch(launchInput);
  assert.equal(typeof prepared, 'function', 'corrected prerequisites prepare without cleanup');
  assert.equal(readFileSync(calls, 'utf8'), 'agent list\n', 'successful preparation only observes; no tab/start before reservation');
  writeFileSync(calls, '');
  writeFileSync(response, JSON.stringify({ result: { agents: [{ pane_id: 'w1:p1', agent: 'pi', foreground_cwd: worktree }] } }));
  await assert.rejects(runtime.prepareLaunch(launchInput), /already has a native agent/);
  assert.equal(readFileSync(calls, 'utf8'), 'agent list\n', 'no create/start when a conflicting writer exists even without native metadata');
  writeFileSync(response, '{"result":{"agents":[]}}');
  writeFileSync(calls, '');
  const partial = await (await runtime.prepareLaunch({ chat, model: { source: 'unselected' }, resume: false, focus: false }))();
  assert.equal(partial.status, 'partial');
  if (partial.status === 'partial') {
    assert.equal(partial.pane, 'w1:p2');
    assert.equal(partial.herdrEndpoint, '/tmp/fixture-herdr.sock');
    assert.match(partial.reason, /pane_not_found/);
  }
  assert.equal(readFileSync(calls, 'utf8'), 'agent list\ntab create\npane process-info\n', 'one creation, no launch retry or close on uncertain preflight');
  assert.equal(await runtime.provenEmpty(chat), false, 'missing history is not native continuity proof');
  await assert.rejects(runtime.history(chat), /Exact native history unavailable/);
});
