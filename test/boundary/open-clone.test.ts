import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cloneRepository } from '../../src/infrastructure/git/project-git.js';

const herdr = `#!/usr/bin/bash
case "$1 $2" in
  'workspace list') echo '{"result":{"type":"workspace_list","workspaces":[]}}' ;;
  'workspace create') echo '{"result":{"workspace":{"workspace_id":"w1","label":"fx/big"},"tab":{"tab_id":"t1"},"root_pane":{"pane_id":"p1"}}}' ;;
  'tab rename') echo '{"result":{"type":"ok"}}' ;;
  'agent start')
    MYPI_SCOPE="\${3^^}" "$FAKE_NODE" "$FAKE_CLI" session register --agent "$5" --native-id "fake-$3" --pid "$PPID" > /dev/null
    echo "{\\"type\\":\\"agent_started\\",\\"name\\":\\"$3\\",\\"pane_id\\":\\"p1\\"}" ;;
esac
`;

const fakeGit = `#!/usr/bin/bash
if [ "\${FAKE_GIT_MODE:-}" = slow ] && [[ " $* " == *" clone "* ]]; then
  target="\${@: -1}"
  mkdir -p "$target/.git"
  echo $$ > "$FAKE_GIT_PID"
  trap 'kill "$child" 2>/dev/null; exit 143' TERM INT
  printf 'Receiving objects:  10%% (1/10), 1.00 MiB | 1.00 MiB/s\\r' >&2
  sleep 30 & child=$!
  wait "$child"
  exit 1
fi
exec /usr/bin/git "$@"
`;

function git(...args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
    { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  assert.equal(result.status, 0, result.stderr);
}

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-clone-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'herdr'), herdr, { mode: 0o755 });
  writeFileSync(join(bin, 'git'), fakeGit, { mode: 0o755 });
  const bare = join(dir, 'remote.git'), seed = join(dir, 'seed');
  git('init', '--bare', '--quiet', '--initial-branch=main', bare);
  git('init', '--quiet', '--initial-branch=main', seed);
  git('-C', seed, 'commit', '--quiet', '--allow-empty', '-m', 'seed');
  git('-C', seed, 'push', '--quiet', bare, 'main');
  const pidFile = join(dir, 'git.pid');
  const gone = () => assert.throws(() => process.kill(Number(readFileSync(pidFile, 'utf8').trim()), 0), { code: 'ESRCH' });
  return { dir, bin, bare, pidFile, gone };
}

function installation(t: TestContext) {
  const fx = fixture(t);
  const root = join(fx.dir, 'engine'), runtime = join(fx.dir, 'run');
  mkdirSync(root);
  mkdirSync(runtime, { mode: 0o700 });
  cpSync('/work/dist', join(root, 'dist'), { recursive: true });
  symlinkSync('/work/node_modules', join(root, 'node_modules'));
  symlinkSync('/work/integrations', join(root, 'integrations'));
  const entry = join(root, 'dist/src/cli/main.js');
  const env: Record<string, string> = { PATH: fx.bin + ':/work/tools:/usr/bin', HOME: fx.dir, XDG_STATE_HOME: join(fx.dir, 'state'),
    XDG_RUNTIME_DIR: runtime, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    FAKE_NODE: process.execPath, FAKE_CLI: entry };
  const cli = (args: string[]) => spawnSync(process.execPath, [entry, ...args], { env, cwd: fx.dir, encoding: 'utf8', timeout: 10000 });
  const ok = (args: string[]) => {
    const result = cli(args);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const url = 'file://' + fx.bare, target = join(root, 'projects', 'fx', 'big');
  ok(['db', 'init']);
  ok(['project', 'add', 'fx/big', '--code', 'FB', '--repository', url]);
  const checkout = () => (ok(['project', 'list']).projects as { code: string; checkoutPath: string | null }[])
    .find(p => p.code === 'FB')!.checkoutPath;
  const clean = () => {
    assert.equal(existsSync(target), false);
    assert.deepEqual(existsSync(join(root, 'projects', 'fx'))
      ? readdirSync(join(root, 'projects', 'fx')).filter(name => name.startsWith('.big.mypi-clone-')) : [], []);
    assert.equal(checkout(), null);
    fx.gone();
  };
  return { ...fx, root, entry, env, cli, ok, url, target, checkout, clean };
}

test('a clone without output for the idle timeout is stopped and its process is gone', async t => {
  const { dir, bin, bare, pidFile, gone } = fixture(t);
  const saved = { PATH: process.env['PATH'], FAKE_GIT_MODE: process.env['FAKE_GIT_MODE'], FAKE_GIT_PID: process.env['FAKE_GIT_PID'] };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env['PATH'] = bin + ':' + saved.PATH;
  process.env['FAKE_GIT_MODE'] = 'slow';
  process.env['FAKE_GIT_PID'] = pidFile;
  const lines: string[] = [];
  await assert.rejects(cloneRepository('file://' + bare, join(dir, 'x'), { idleTimeoutMs: 300, onLine: l => lines.push(l) }),
    /made no progress for 0.3 s and was stopped/);
  assert.ok(lines.includes('Receiving objects: 10% (1/10), 1.00 MiB | 1.00 MiB/s'), JSON.stringify(lines));
  gone();
});

test('CLI open shows clone progress, stops on SIGINT and SIGTERM leaving nothing, and opens on the next call', async t => {
  const { entry, env, pidFile, cli, url, target, checkout, clean } = installation(t);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    const child = spawn(process.execPath, [entry, 'open', 'FB'], { env: { ...env, FAKE_GIT_MODE: 'slow', FAKE_GIT_PID: pidFile } });
    t.after(() => { child.kill('SIGKILL'); });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    await new Promise<void>((resolve, reject) => {
      child.once('exit', code => reject(new Error('open exited early with ' + code + ': ' + stderr)));
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (stderr.split('\n').some(line => line.startsWith('mypi: cloning ' + url + ' into ' + target) && line.includes('Receiving objects: 10%'))) resolve();
      });
    });
    child.removeAllListeners('exit');
    const exited = new Promise<[number | null, string | null]>(resolve => child.once('close', (code, signal) => resolve([code, signal])));
    child.kill(sig);
    const [code, signal] = await exited;
    assert.ok(code === 130 || code === 143, String(code));
    assert.equal(signal, null);
    assert.equal(stdout, '');
    const last = JSON.parse(stderr.split('\n').filter(line => line.trim() !== '').at(-1)!);
    assert.equal(last.status, 'error');
    assert.match(last.message, /^open cancelled while cloning file:\/\/.* into .*\/projects\/fx\/big; nothing was registered$/);
    clean();
  }
  const opened = cli(['open', 'FB']);
  assert.equal(opened.status, 0, opened.stderr);
  assert.ok(JSON.parse(opened.stdout).opened[0].notes.includes('clone prepared: cloned ' + target + ' from ' + url), opened.stdout);
  assert.equal(checkout(), target);
});

test('MCP open_session reports clone progress, a cancelled call leaves nothing and the server keeps serving', async t => {
  const { root, env, pidFile, url, target, clean } = installation(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/src/mcp/main.js')],
    cwd: root, env: { ...env, FAKE_GIT_MODE: 'slow', FAKE_GIT_PID: pidFile }, stderr: 'pipe' });
  const client = new Client({ name: 'test', version: '1' });
  t.after(async () => { await client.close(); });
  await client.connect(transport);
  const controller = new AbortController();
  const messages: string[] = [];
  await assert.rejects(client.callTool({ name: 'open_session', arguments: { keys: ['FB'] } }, undefined, {
    onprogress: progress => {
      messages.push(progress.message ?? '');
      if (progress.message?.includes('Receiving objects: 10%')) controller.abort();
    },
    signal: controller.signal, timeout: 20000,
  }));
  assert.equal(messages[0], 'cloning ' + url + ' into ' + target);
  const listed = await client.callTool({ name: 'projects', arguments: { action: 'list' } });
  const value = listed.structuredContent as { status: string; data: { projects: { code: string; checkoutPath: string | null }[] } };
  assert.equal(value.status, 'ok');
  assert.equal(value.data.projects.find(p => p.code === 'FB')!.checkoutPath, null);
  clean();
});
