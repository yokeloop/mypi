import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import install from '../../src/app/startup-extension.js';
import { workChatCli } from '../../src/app/work-chat-cli.js';

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) { assert.ok(Date.now() < deadline, 'bounded fixture/cleanup wait'); await delay(10); }
}

test('production slash CLI is outside the overlapping parent group, with bounded capture and owned-group cleanup', async t => {
  const root = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'mypi-slash-cli-'));
  const ready = join(dir, 'ready.json'), tools = join(dir, 'tools'), marker = join(dir, 'marker');
  mkdirSync(tools); mkdirSync(marker);
  const previous = { PATH: process.env.PATH, MYPI_TEST_READY: process.env.MYPI_TEST_READY, MYPI_TEST_MODE: process.env.MYPI_TEST_MODE };
  t.after(() => {
    process.chdir(root);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  const shim = join(tools, 'node');
  writeFileSync(shim, `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const stat = pid => {
  const text = readFileSync('/proc/' + pid + '/stat', 'utf8');
  const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
  return { pid, ppid: Number(fields[1]), group: Number(fields[2]), session: Number(fields[3]) };
};
const result = { argv: process.argv.slice(2), cwd: process.cwd(), self: stat(process.pid), parent: stat(process.ppid) };
const mode = process.env.MYPI_TEST_MODE;
process.on('SIGTERM', () => {});
if (mode === 'echo') {
  console.log(JSON.stringify(result));
  setTimeout(() => process.exit(0), 40);
} else if (mode === 'overflow') {
  writeFileSync(process.env.MYPI_TEST_READY, JSON.stringify(result));
  process.stdout.write('x'.repeat(1024 * 1024 + 1));
  setInterval(() => {}, 1000);
} else {
  const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); console.log(process.pid); setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'inherit'] });
  descendant.stdout.once('data', () => {
    result.descendant = stat(descendant.pid);
    writeFileSync(process.env.MYPI_TEST_READY, JSON.stringify(result));
    if (mode === 'error') { console.log(JSON.stringify(result)); process.stderr.write('CLI rejected\\n', () => process.exit(7)); }
  });
}
`);
  chmodSync(shim, 0o700);
  process.env.PATH = tools + ':' + previous.PATH;
  process.env.MYPI_TEST_READY = ready;
  process.env.MYPI_TEST_MODE = 'echo';
  let handler!: (args: string, ctx: any) => Promise<void>;
  const notices: string[] = [];
  install({ registerMcpServer() {}, registerFlag() {}, on() {},
    registerCommand(_name: string, command: { handler: typeof handler }) { handler = command.handler; },
    exec() { throw new Error('Slash must not use same-group pi.exec'); },
  } as never);
  const controller = new AbortController();
  const ctx = { cwd: marker, signal: controller.signal, ui: { notify(text: string) { notices.push(text); } } };
  process.chdir(marker);
  const preview = JSON.stringify({ path: '/a path/with spaces', text: '$(touch should-not-exist); "quoted"' }, null, 2);
  await handler('execute --preview ' + preview + ' --focus', { cwd: marker, ui: ctx.ui });
  const observed = JSON.parse(notices.at(-1)!);
  const cli = join(root, 'dist/src/cli/main.js');
  assert.deepEqual(observed.argv, [cli, 'work-chat', 'execute', '--preview', preview, '--focus']);
  assert.equal(observed.cwd, root, 'engine cwd preserved despite parent worktree cwd');
  assert.equal(observed.self.ppid, process.pid, 'parent and CLI deliberately overlap');
  assert.equal(observed.parent.pid, process.pid);
  await until(() => !existsSync('/proc/' + observed.self.pid));
  assert.notEqual(observed.self.group, observed.parent.group, 'slash observer must not join Pi foreground group');
  assert.equal(observed.self.group, observed.self.pid);
  assert.equal(observed.self.session, observed.self.pid);
  assert.equal(existsSync(join(root, 'should-not-exist')), false);
  process.chdir(root);

  type Facts = { self: { pid: number; group: number }; descendant?: { pid: number; group: number } };
  const facts = (): Facts => JSON.parse(readFileSync(ready, 'utf8')) as Facts;
  const reaped = async (seen: Facts) => {
    if (seen.descendant) assert.equal(seen.descendant.group, seen.self.group, 'ordinary descendant belongs to owned CLI group');
    await until(() => !existsSync('/proc/' + seen.self.pid) && (!seen.descendant || !existsSync('/proc/' + seen.descendant.pid)));
    assert.doesNotThrow(() => process.kill(process.pid, 0), 'parent was not signalled');
    rmSync(ready, { force: true });
  };
  const options = { cwd: root, timeout: 1000, signal: undefined };
  process.env.MYPI_TEST_MODE = 'error';
  const rejected = await workChatCli(cli, ['work-chat', 'list'], options);
  assert.equal(rejected.code, 7); assert.equal(rejected.stderr, 'CLI rejected\n');
  assert.equal(rejected.killed, false); assert.deepEqual(JSON.parse(rejected.stdout).argv, [cli, 'work-chat', 'list']);
  await reaped(facts());

  process.env.MYPI_TEST_MODE = 'hold';
  const pending = handler('list', ctx);
  await until(() => existsSync(ready));
  const cancelled = facts(); controller.abort(); await pending;
  assert.match(notices.at(-1)!, /cancelled.*action may have occurred/);
  await reaped(cancelled);
  await handler('list', ctx);
  assert.match(notices.at(-1)!, /cancelled before dispatch/);
  assert.equal(existsSync(ready), false, 'already aborted signal must not spawn');

  const timedOut = await workChatCli(cli, ['work-chat', 'list'], options);
  assert.equal(timedOut.code, 1); assert.equal(timedOut.killed, true); assert.match(timedOut.stderr, /timed out/);
  await reaped(facts());
  process.env.MYPI_TEST_MODE = 'overflow';
  const overflow = await workChatCli(cli, ['work-chat', 'list'], options);
  assert.equal(overflow.code, 1); assert.equal(overflow.killed, true); assert.match(overflow.stderr, /output limit/);
  assert.ok(Buffer.byteLength(overflow.stdout) <= 1024 * 1024);
  await reaped(facts());

  process.env.PATH = dir;
  const missing = await workChatCli(cli, ['work-chat', 'list'], options);
  assert.equal(missing.code, 1); assert.match(missing.stderr, /spawn failed.*ENOENT/);
  await assert.rejects(workChatCli(cli, [], { ...options, timeout: 0 }), /timeout/);
});
