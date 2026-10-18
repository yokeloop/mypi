import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { nativeChatRuntime } from '../../src/app/native-chat-runtime.js';
import type { WorkChat } from '../../src/modules/work-chats/public.js';

// The fake Pi answers catalog/auth only; it cannot send a model request.
test('work chat pins ordinary agent resources and loads installed package only when absent', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-chat-resources-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'), worktree = join(dir, 'task'), state = join(dir, 'state');
  const agent = join(dir, 'agent'), home = join(dir, 'home'), bin = join(dir, 'bin');
  for (const path of [source, state, agent, home, bin]) mkdirSync(path);
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(source, 'init', '-q'); git(source, 'config', 'user.name', 'Tester'); git(source, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(source, 'tracked'), 'initial'); git(source, 'add', 'tracked'); git(source, 'commit', '-qm', 'initial');
  git(source, 'worktree', 'add', '-qb', 'task/one', worktree);
  writeFileSync(join(home, 'USER-INSTRUCTIONS.md'), 'Synthetic fixture only\n');
  const installation = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  const packageDir = join(installation, 'integrations', 'pi');
  const pi = join(bin, 'pi'), herdr = join(bin, 'herdr'), log = join(dir, 'herdr.log');
  writeFileSync(pi, `#!/bin/sh
if [ "$1" = "--offline" ] && [ "$2" = "--list-models" ]; then
  printf 'provider  model  context  max-out  thinking  images\\nfixture  exact  100  50  no  no\\n'
elif [ "$1" = "auth" ]; then
  if [ "$4" = "fixture" ] && [ "$6" = "exact" ]; then
    printf '{"status":"ready","provider":"fixture","authType":"test"}\\n'
  else
    printf '{"status":"missing","provider":"fixture"}\\n'
  fi
else
  exit 2
fi
`);
  writeFileSync(herdr, `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = "tab" ]; then
  printf '{"result":{"root_pane":{"pane_id":"fixture-pane"}}}\\n'
else
  exit 2
fi
`);
  chmodSync(pi, 0o700); chmodSync(herdr, 0o700);
  const prior = { PATH: process.env.PATH, HERDR_ENV: process.env.HERDR_ENV, HERDR_WORKSPACE_ID: process.env.HERDR_WORKSPACE_ID };
  process.env.PATH = bin + ':' + prior.PATH;
  process.env.HERDR_ENV = '1'; process.env.HERDR_WORKSPACE_ID = 'fixture-workspace';
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const runtime = nativeChatRuntime({ pi, nodePath: process.execPath, installation, statePath: state, userHome: home,
    agentDir: agent, identity: () => 'fixture/tool' });
  const checked = await runtime.validate({ sourceClone: source, worktree, installation, statePath: state });
  const chat: WorkChat = { ...checked, projectId: 1, requestId: 1, id: 'fixture-chat', name: null,
    attemptId: 'fixture-attempt', phase: 'reserved', sessionId: null, historyPath: null,
    pane: null, processId: null, processStart: null };
  const model = { provider: 'fixture', model: 'exact', source: 'invocation' as const };
  const refuse = async (selection: typeof model) => {
    await assert.rejects(runtime.launch({ chat, model: selection, resume: false, focus: false }));
    assert.equal(readFileSync(log, 'utf8'), '');
  };
  writeFileSync(log, '');
  await refuse({ ...model, model: 'wrong' });
  await refuse({ ...model, provider: 'wrong' });
  const first = await runtime.launch({ chat, model, resume: false, focus: false });
  assert.equal(first.status, 'partial'); // Fake Herdr refuses pane run; no real Pi process starts.
  let calls = readFileSync(log, 'utf8');
  assert.match(calls, /tab create.*PI_CODING_AGENT_DIR=/);
  assert.match(calls, /pane run.*'-e' '[^']*\/integrations\/pi'/);
  assert.match(calls, /'--append-system-prompt' '[^']*\/USER-INSTRUCTIONS\.md'/);
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [{ source: packageDir, skills: [] }] }));
  writeFileSync(log, '');
  await runtime.launch({ chat, model, resume: false, focus: false });
  calls = readFileSync(log, 'utf8');
  assert.match(calls, /pane run/);
  assert.doesNotMatch(calls, / '-e' /);
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [packageDir, packageDir] }));
  writeFileSync(log, '');
  await refuse(model);
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [join(dir, 'foreign-pi')] }));
  mkdirSync(join(dir, 'foreign-pi'));
  writeFileSync(join(dir, 'foreign-pi', 'package.json'), '{"name":"mypi-pi"}');
  await refuse(model);

  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [] }));
  const ancestorPi = join(dir, '.pi'), projectPi = join(worktree, '.pi');
  mkdirSync(ancestorPi); mkdirSync(projectPi);
  writeFileSync(join(ancestorPi, 'settings.json'), JSON.stringify({ packages: [join(dir, 'foreign-pi')] }));
  writeFileSync(log, '');
  await runtime.launch({ chat, model, resume: false, focus: false });
  assert.match(readFileSync(log, 'utf8'), /pane run.*'-e' '[^']*\/integrations\/pi'/);
  // An installed-root ancestor may configure this package, but Pi does not load it for the worktree.
  writeFileSync(join(ancestorPi, 'settings.json'), JSON.stringify({ packages: [packageDir] }));
  writeFileSync(log, '');
  await runtime.launch({ chat, model, resume: false, focus: false });
  assert.match(readFileSync(log, 'utf8'), /pane run.*'-e' '[^']*\/integrations\/pi'/);

  const projectSettings = join(projectPi, 'settings.json');
  writeFileSync(projectSettings, JSON.stringify({ packages: ['./../../foreign-pi'] }));
  writeFileSync(log, '');
  await refuse(model); // Project-local paths resolve relative to the worktree's .pi.
  writeFileSync(projectSettings, JSON.stringify({ packages: [packageDir, packageDir] }));
  await refuse(model);
  writeFileSync(projectSettings, JSON.stringify({ packages: [{ source: packageDir, extensions: [] }] }));
  await runtime.launch({ chat, model, resume: false, focus: false });
  const projectCalls = readFileSync(log, 'utf8');
  assert.match(projectCalls, /pane run/);
  assert.doesNotMatch(projectCalls, / '-e' /);
});
