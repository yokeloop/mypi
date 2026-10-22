import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeState, createApp } from '../../src/app/create-app.js';
import { executeCommand, readonlyWorkChatCommand } from '../../src/app/execute-command.js';

test('installed-layout previews are read-only; ordinary request opening returns explicit setup/choice/errors', async t => {
  assert.equal(readonlyWorkChatCommand('work_chat_open'), true, 'preview has no database writes');
  for (const name of ['work_chat_resume', 'work_chat_show', 'work_chat_list', 'work_chat_new_empty'] as const)
    assert.equal(readonlyWorkChatCommand(name), true, name);
  assert.equal(readonlyWorkChatCommand('work_chat_open_request'), false);
  assert.equal(readonlyWorkChatCommand('work_chat_execute'), false);
  const dir = mkdtempSync(join(tmpdir(), 'mypi-chat-dispatch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'), worktree = join(dir, 'task'), home = join(dir, 'home');
  const state = join(dir, 'state'), agent = join(dir, 'agent'), pi = process.execPath;
  for (const path of [source, home, state, agent]) mkdirSync(path);
  function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
  }
  git(source, 'init', '-q');
  git(source, 'config', 'user.name', 'Tester'); git(source, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(source, 'tracked'), 'initial'); git(source, 'add', 'tracked'); git(source, 'commit', '-qm', 'initial');
  git(source, 'worktree', 'add', '-qb', 'task/one', worktree);
  const installation = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [join(installation, 'integrations', 'pi')] }));
  writeFileSync(join(home, 'USER-INSTRUCTIONS.md'), 'Synthetic fixture only\n');
  const filename = join(state, 'mypi', 'state.sqlite3');
  initializeState(filename);
  const app = createApp(filename, false);
  let requestId: number;
  try {
    const project = app.projects.add('fixture/tool', 'FX', source);
    requestId = app.requests.create({ projectId: project.id, slug: 'one', title: 'One', status: 'new' }, () => {}).id;
  } finally { app.close(); }
  const previousPi = process.env.MYPI_WORK_CHAT_PI, previousAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.MYPI_WORK_CHAT_PI = pi; process.env.PI_CODING_AGENT_DIR = agent;
  t.after(() => {
    if (previousPi === undefined) delete process.env.MYPI_WORK_CHAT_PI; else process.env.MYPI_WORK_CHAT_PI = previousPi;
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
  });
  const preview = await executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId,
    sourceClone: source, worktree, model: { provider: 'fixture', model: 'exact' } }, filename, home);
  assert.equal((preview as { action: string }).action, 'open');
  assert.equal((preview as { binding: { installation: string } }).binding.installation, installation);
  assert.deepEqual((preview as { model: unknown }).model, { provider: 'fixture', model: 'exact', source: 'invocation' },
    'internal source-bearing selection reaches exact pair validation');
  await assert.rejects(executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId,
    sourceClone: source, worktree, model: { provider: '', model: 'exact' } }, filename, home), /nonempty exact provider/);
  const unselected = await executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId, sourceClone: source, worktree }, filename, home);
  assert.deepEqual((unselected as { model: unknown }).model, { source: 'unselected' });
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['/another/installation/integrations/pi'] }));
  await assert.rejects(executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId, sourceClone: source, worktree }, filename, home), /not uniquely configured/);
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [join(installation, 'integrations', 'pi')] }));
  // Node is deliberately not Pi: any obsolete catalog/auth subprocess would fail.
  const preference = await executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId,
    sourceClone: source, worktree, model: { provider: 'not-authenticated', model: 'exact/id' } }, filename, home);
  assert.deepEqual((preference as { model: unknown }).model, { provider: 'not-authenticated', model: 'exact/id', source: 'invocation' });
  const setup = await executeCommand({ name: 'work_chat_open_request', identity: 'fixture/tool', requestId }, filename, home) as any;
  assert.equal(setup.status, 'error'); assert.equal(setup.outcome, 'setup-needed'); assert.match(setup.reason, /association|worktree/);
  const cli = spawnSync(process.execPath, [join(installation, 'dist/src/cli/main.js'), 'work-chat', 'open-request',
    '--project', 'fixture/tool', '--request-id', String(requestId)], {
    env: { ...process.env, XDG_STATE_HOME: state }, cwd: dir, encoding: 'utf8', timeout: 3000,
  });
  assert.ifError(cli.error); assert.equal(cli.status, 1); assert.equal(cli.stdout, '');
  assert.equal(JSON.parse(cli.stderr).outcome, 'setup-needed', 'CLI cannot report an unopened setup request as success');
  const reader = createApp(filename, true);
  try { assert.deepEqual(reader.chatStore.list(), []); } finally { reader.close(); }
  const writer = createApp(filename, false);
  const binding = (preview as { binding: import('../../src/modules/work-chats/public.js').ChatBinding }).binding;
  try {
    for (const id of ['first', 'second']) writer.chatStore.reserve({ ...binding, id, name: id, phase: 'closed',
      attemptId: 'attempt-' + id, sessionId: 'session-' + id, historyPath: join(state, id + '.jsonl'),
      pane: null, processId: null, processStart: null, requestedProvider: null, requestedModel: null });
  } finally { writer.close(); }
  const choice = await executeCommand({ name: 'work_chat_open_request', identity: 'fixture/tool', requestId }, filename, home) as any;
  assert.equal(choice.status, 'error'); assert.equal(choice.outcome, 'choice-needed');
  assert.deepEqual(choice.chats.map((chat: { id: string }) => chat.id), ['first', 'second']);
  assert.match(choice.reason, /chat-id/);
  await assert.rejects(executeCommand({ name: 'work_chat_open_request', identity: 'fixture/tool', requestId, chatId: 'foreign' }, filename, home), /another request\/project/);
  await assert.rejects(executeCommand({ name: 'work_chat_open_request', identity: 'fixture/tool', requestId, chatId: 'first' }, filename, home), /ownership unknown/);
  const after = createApp(filename, true);
  try { assert.deepEqual(after.chatStore.list(), choice.chats, 'choice and refused selection preserve every association/history field'); }
  finally { after.close(); }
});
