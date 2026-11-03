import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneRepository } from '../../src/infrastructure/git/project-git.js';

const herdr = `#!/usr/bin/bash
case "$1 $2" in
  'workspace list') echo '{"result":{"type":"workspace_list","workspaces":[]}}' ;;
  'workspace create') echo '{"result":{"workspace":{"workspace_id":"w1","label":"fx/big"},"tab":{"tab_id":"t1"},"root_pane":{"pane_id":"p1"}}}' ;;
  'tab rename') echo '{"result":{"type":"ok"}}' ;;
  'agent start') echo "{\\"type\\":\\"agent_started\\",\\"name\\":\\"$3\\",\\"pane_id\\":\\"p1\\"}" ;;
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
