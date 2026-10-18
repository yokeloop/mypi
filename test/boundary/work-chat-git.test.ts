import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeChatRuntime } from '../../src/app/native-chat-runtime.js';

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
  const runtime = nativeChatRuntime({ pi: process.execPath, nodePath: process.execPath,
    installation: join(dir, 'engine'), statePath: join(dir, 'state'), userHome: dir,
    agentDir: join(dir, 'agent'), identity: () => 'team/tool' });
  const args = { sourceClone: source, worktree, installation: join(dir, 'engine'), statePath: join(dir, 'state') };
  const checked = await runtime.validate(args);
  assert.equal(checked.branch, 'task/one');
  assert.equal(checked.worktree, worktree);
  await assert.rejects(runtime.validate({ ...args, worktree: foreign }), /Foreign Git worktree|Git checkout/);
  await assert.rejects(runtime.validate({ ...args, sourceClone: join(dir, 'engine') }), /installed-engine|Git checkout/);
});
