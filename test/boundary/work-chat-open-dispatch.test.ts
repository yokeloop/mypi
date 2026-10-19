import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeState, createApp } from '../../src/app/create-app.js';
import { executeCommand } from '../../src/app/execute-command.js';

test('installed-layout work-chat open dispatch previews a valid Git worktree with pinned native resources', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-chat-dispatch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'), worktree = join(dir, 'task'), home = join(dir, 'home');
  const state = join(dir, 'state'), agent = join(dir, 'agent'), pi = join(dir, 'fixture-pi');
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
  writeFileSync(pi, `#!/bin/sh
if [ "$1" = "--offline" ]; then
  printf 'provider  model  context  max-out  thinking  images\\nfixture  exact  100  50  no  no\\n'
elif [ "$1" = "auth" ]; then
  printf '{"status":"ready","provider":"fixture","authType":"test"}\\n'
else
  exit 2
fi
`);
  chmodSync(pi, 0o700);
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
  const unselected = await executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId, sourceClone: source, worktree }, filename, home);
  assert.deepEqual((unselected as { model: unknown }).model, { source: 'unselected' });
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['/another/installation/integrations/pi'] }));
  await assert.rejects(executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId, sourceClone: source, worktree }, filename, home), /not uniquely configured/);
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [join(installation, 'integrations', 'pi')] }));
  writeFileSync(pi, `#!/bin/sh
if [ "$1" = "--offline" ]; then
  printf 'provider  model  context  max-out  thinking  images\\n'
elif [ "$1" = "auth" ]; then
  printf '{"status":"not_ready","provider":"fixture"}\\n'
  exit 1
else
  exit 2
fi
`);
  const pending = await executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId,
    sourceClone: source, worktree, model: { provider: 'fixture', model: 'exact' } }, filename, home);
  assert.equal((pending as { action: string }).action, 'open', 'missing auth must not block preview when Pi hides the catalog');
  const unavailableUntilLogin = await executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId,
    sourceClone: source, worktree, model: { provider: 'fixture', model: 'absent' } }, filename, home);
  assert.equal((unavailableUntilLogin as { action: string }).action, 'open', 'catalog validity is deferred, not invented');
  writeFileSync(pi, `#!/bin/sh
if [ "$1" = "--offline" ]; then
  printf 'provider  model  context  max-out  thinking  images\\nfixture  exact  100  50  no  no\\n'
elif [ "$1" = "auth" ]; then
  printf '{"status":"ready","provider":"fixture","authType":"test"}\\n'
else
  exit 2
fi
`);
  await assert.rejects(executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId,
    sourceClone: source, worktree, model: { provider: 'fixture', model: 'absent' } }, filename, home), /Exact target model unavailable/);
  writeFileSync(pi, `#!/bin/sh
if [ "$1" = "--offline" ]; then
  printf 'provider  model  context  max-out  thinking  images\\nfixture  exact  100  50  no  no\\n'
elif [ "$1" = "auth" ]; then
  printf '{"status":"invalid","provider":"fixture"}\\n'
  exit 2
fi
`);
  await assert.rejects(executeCommand({ name: 'work_chat_open', identity: 'fixture/tool', requestId,
    sourceClone: source, worktree, model: { provider: 'fixture', model: 'exact' } }, filename, home), /auth check unavailable or invalid/);
  const reader = createApp(filename, true);
  try { assert.deepEqual(reader.chatStore.list(), []); } finally { reader.close(); }
});
