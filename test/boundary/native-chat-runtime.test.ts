import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { nativeChatRuntime } from '../../src/app/native-chat-runtime.js';
import type { WorkChat } from '../../src/modules/work-chats/public.js';

test('native dispatch accepts empty pane-run stdout but waits for captured resolution before one native start', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-native-dispatch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clone = join(dir, 'clone'), worktree = join(dir, 'task'), engine = join(dir, 'engine');
  const state = join(dir, 'state'), agent = join(dir, 'agent'), tools = join(dir, 'tools');
  for (const path of [clone, engine, state, agent, tools]) mkdirSync(path);
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: clone, encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q'); git('config', 'user.name', 'Tester'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(clone, 'tracked'), 'fixture'); git('add', 'tracked'); git('commit', '-qm', 'fixture');
  git('worktree', 'add', '-qb', 'task/dispatch', worktree);
  mkdirSync(join(engine, 'dist/src/app'), { recursive: true });
  writeFileSync(join(engine, 'dist/src/app/startup-extension.js'), 'fixture');
  writeFileSync(join(dir, 'USER-INSTRUCTIONS.md'), 'fixture');
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [join(engine, 'integrations/pi')] }));
  const stock = join(dir, 'stock.ts');
  writeFileSync(stock, '// installed by herdr\n// HERDR_INTEGRATION_ID=pi\npane.report_agent_session');
  // A real owned shell supplies procfs identity. It never executes Pi or contacts Herdr.
  const shell = spawn('/bin/bash', ['--noprofile', '--norc', '-c', 'read -r line'], { cwd: worktree, stdio: ['pipe', 'ignore', 'ignore'] });
  await once(shell, 'spawn');
  t.after(async () => { const exited = once(shell, 'exit'); shell.stdin.end('\n'); await exited; });
  const calls = join(dir, 'calls.jsonl'), queued = join(dir, 'probe'), capture = join(dir, 'capture-path');
  const fake = join(tools, 'herdr');
  writeFileSync(fake, `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2), action = args.slice(0, 2).join(' ');
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
const reply = result => console.log(JSON.stringify({ result }));
switch (action) {
  case 'agent list': reply({ agents: [] }); break;
  case 'tab create': reply({ root_pane: { pane_id: 'w1:p2' } }); break;
  case 'pane process-info': reply({ process_info: { shell_pid: ${shell.pid}, foreground_process_group_id: ${shell.pid},
    foreground_processes: [{ pid: ${shell.pid}, cwd: ${JSON.stringify(worktree)} }] } }); break;
  case 'pane run':
    // Real CLI acknowledges input with exit 0 and no payload; command completion is later.
    writeFileSync(${JSON.stringify(queued)}, args[3]); break;
  case 'pane wait-output': {
    if (args[args.indexOf('--timeout') + 1] !== '3000') process.exit(2);
    if (process.env.FIXTURE_WAIT_FAILURE === '1') {
      console.error(JSON.stringify({ error: { code: 'timeout', message: 'no marker' } })); process.exit(1);
    }
    const probe = readFileSync(${JSON.stringify(queued)}, 'utf8');
    const path = / > '([^']+)'/.exec(probe)[1];
    writeFileSync(${JSON.stringify(capture)}, path);
    // The shell resolves a synthetic pi path; never run that executable.
    const ran = spawnSync('/bin/sh', ['-c', probe], { encoding: 'utf8', timeout: 2000,
      env: { ...process.env, PATH: ${JSON.stringify(tools)} + ':' + process.env.PATH } });
    const marker = args[args.indexOf('--match') + 1];
    if (ran.status !== 0 || !ran.stdout.includes(marker)) process.exit(3);
    reply({ type: 'output_matched', pane_id: 'w1:p2', revision: 1, matched_line: marker }); break;
  }
  case 'agent start': reply({ type: 'agent_started' }); break;
  case 'agent get': reply({ agent: { pane_id: 'w1:p2', agent: 'pi', foreground_cwd: ${JSON.stringify(worktree)} } }); break;
  default: process.exit(4);
}
`);
  chmodSync(fake, 0o700);
  // Resolution must equal the configured direct ELF, but the fixture never launches it.
  symlinkSync(process.execPath, join(tools, 'pi'));
  const values = { PATH: tools + ':' + process.env.PATH, HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w1',
    HERDR_SOCKET_PATH: '/tmp/fixture-herdr.sock', MYPI_WORK_CHAT_HERDR_EXTENSION: stock,
    HOME: join(dir, 'home'), ZDOTDIR: join(dir, 'zsh'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_CACHE_HOME: join(dir, 'cache'),
    FIXTURE_WAIT_FAILURE: '0', NOT_FORWARDED_SECRET: 'synthetic-test-value' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const runtime = nativeChatRuntime({ pi: process.execPath, nodePath: process.execPath, userHome: dir,
    agentDir: agent, installation: engine, statePath: state, identity: () => 'team/tool' });
  const checked = await runtime.validate({ sourceClone: clone, worktree, installation: engine, statePath: state });
  const chat: WorkChat = { ...checked, projectId: 1, requestId: 1, id: 'chat', name: null, attemptId: 'attempt',
    sessionId: 'assigned-id', historyPath: null, pane: null, processId: null, processStart: null,
    requestedProvider: null, requestedModel: null, phase: 'reserved' };
  const input = { chat, model: { source: 'unselected' as const }, resume: false, focus: false };
  const result = await (await runtime.prepareLaunch(input))();
  const invoked = (): string[][] => readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
  const actions = (items: string[][]) => items.map(args => args.slice(0, 2).join(' '));
  assert.equal(invoked().filter(args => args[0] === 'agent' && args[1] === 'start').length, 1, JSON.stringify(result));
  const sequence = actions(invoked());
  assert.ok(sequence.indexOf('pane run') < sequence.indexOf('pane wait-output'));
  assert.ok(sequence.indexOf('pane wait-output') < sequence.indexOf('agent start'));
  assert.equal(sequence.filter(action => action === 'pane process-info').length, 3, 'shell checked before/after probe and incomplete native observation');
  assert.equal(existsSync(readFileSync(capture, 'utf8')), false, 'capture removed only after successful bounded resolution');
  assert.equal(result.status, 'partial', 'dispatch is not proof of native identity');
  assert.equal(result.pane, 'w1:p2');
  const tab = invoked().find(args => args[0] === 'tab')!;
  const forwarded = Object.fromEntries(tab.flatMap((arg, i) => arg === '--env' ? [tab[i + 1]!.split(/=(.*)/s).slice(0, 2)] : []));
  for (const key of ['HOME', 'ZDOTDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) assert.equal(forwarded[key], process.env[key], key);
  assert.equal(forwarded.XDG_STATE_HOME, state);
  assert.equal(forwarded.PI_CODING_AGENT_DIR, agent);
  assert.equal(forwarded.MYPI_WORK_CHAT_PI, process.execPath);
  assert.equal(forwarded.PI_OFFLINE, '1');
  assert.equal(forwarded.PATH, dirname(process.execPath) + ':' + dirname(process.execPath) + ':' + values.PATH);
  assert.deepEqual(Object.keys(forwarded).sort(), ['HOME', 'ZDOTDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
    'XDG_STATE_HOME', 'PI_CODING_AGENT_DIR', 'MYPI_WORK_CHAT_PI', 'PI_OFFLINE', 'PATH'].sort());
  assert.equal(forwarded.NOT_FORWARDED_SECRET, undefined);

  // A failed bounded observation is not command completion and must not dispatch Pi.
  writeFileSync(calls, ''); process.env.FIXTURE_WAIT_FAILURE = '1';
  const failed = await (await runtime.prepareLaunch(input))();
  assert.equal(failed.status, 'partial'); assert.equal(failed.pane, 'w1:p2');
  assert.match(failed.reason!, /timeout/);
  assert.equal(actions(invoked()).includes('pane wait-output'), true);
  assert.equal(actions(invoked()).includes('agent start'), false);
});
