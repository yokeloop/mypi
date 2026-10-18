import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { state } from '../support/state.js';
import { initializeWorkspace, createWorkspace } from '../../src/app/create-workspace.js';
import { publishBackup } from '../../src/app/backup.js';
import { run } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { toolCommand } from '../../src/mcp/tools.js';

function git(...args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('published snapshot is exact, from fresh remote clone, keeps unrelated index and ignores caches', async t => {
  const { dir, filename } = state(t), home = join(dir, 'home'), bare = join(dir, 'remote.git');
  initializeWorkspace(filename, home);
  git('init', '--bare', '--quiet', bare);
  git('-C', home, 'remote', 'add', 'origin', bare);
  const app = createWorkspace(filename, false, home);
  app.memory.add('committed');
  const card = app.requests.create({ title: 'Backup', status: 'new', slug: 'backup', source: 'source\r\n' });
  app.requests.progress(card.key, 'artifact', [{ path: 'artifacts/result.md', text: 'evidence' }]);
  app.close();
  writeFileSync(join(home, 'MEMORY.md'), 'unselected edit\n');
  writeFileSync(join(home, 'unrelated.md'), 'staged bytes');
  writeFileSync(join(home, 'chosen.md'), 'selected exact bytes\r\n');
  git('-C', home, 'add', 'unrelated.md');
  mkdirSync(join(home, '.cache')); writeFileSync(join(home, '.cache', 'work'), 'cache');
  writeFileSync(join(home, '.gitignore'), '.cache/\n');
  git('-C', home, 'add', '.gitignore');
  const staged = git('-C', home, 'ls-files', '-s', 'unrelated.md');
  const preview = await run(parseCommand(['backup', '--publish', '--dry-run']), filename, home) as Awaited<ReturnType<typeof publishBackup>>;
  assert.equal(preview.status, 'preview');
  assert.equal(preview.snapshotSaved, false);
  assert.ok(preview.excludedPaths.includes('MEMORY.md'));
  assert.ok(preview.selectedPaths.includes(card.contextDir + '/source.md'));
  const result = await executeCommand(toolCommand('backup_publish', { selectedPaths: ['chosen.md'] }), filename, home) as Awaited<ReturnType<typeof publishBackup>>;
  assert.equal(result.status, 'published', result.error);
  assert.equal(result.publicationConfirmed, true);
  assert.equal(git('-C', bare, 'rev-parse', 'refs/heads/main'), result.commit);
  assert.equal(git('-C', home, 'ls-files', '-s', 'unrelated.md'), staged);
  assert.equal(readFileSync(join(home, 'MEMORY.md'), 'utf8'), 'unselected edit\n');
  assert.equal(git('-C', bare, 'show', result.commit + ':MEMORY.md').includes('unselected edit'), false);
  assert.equal(git('-C', bare, 'ls-tree', '-r', '--name-only', result.commit!).includes('.cache/work'), false);
  const clone = join(dir, 'fresh'); git('clone', '--quiet', bare, clone);
  const restoredDb = join(dir, 'restored.sqlite3'), restoredHome = join(dir, 'restored');
  await run(parseCommand(['restore', '--repository', clone, '--commit', result.commit!]), restoredDb, restoredHome);
  const restored = createWorkspace(restoredDb, true, restoredHome);
  try {
    assert.equal(restored.read(card.contextDir + '/source.md'), 'source\r\n');
    assert.equal(restored.read(card.contextDir + '/artifacts/result.md'), 'evidence');
    assert.equal(restored.memory.show().items[0]?.text, 'committed');
  } finally { restored.close(); }
  assert.equal(existsSync(join(restoredHome, 'unrelated.md')), false);
  assert.equal(readFileSync(join(restoredHome, 'chosen.md'), 'utf8'), 'selected exact bytes\r\n');
  await assert.rejects(run(parseCommand(['restore', '--repository', clone, '--commit', result.commit!]), restoredDb, restoredHome), /absent/);
});

test('push rejection retains exact local commit; required excluded files refuse, ignored cache does not block local backup', async t => {
  const { dir, filename } = state(t), home = join(dir, 'home'), bare = join(dir, 'remote.git');
  initializeWorkspace(filename, home);
  git('init', '--bare', '--quiet', bare); git('-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git('-C', home, 'remote', 'add', 'origin', bare);
  git('-C', home, 'config', 'user.name', 'Fixture'); git('-C', home, 'config', 'user.email', 'fixture@example.test');
  const app = createWorkspace(filename, false, home);
  app.memory.add('keep');
  const card = app.requests.create({ title: 'Required', status: 'new', slug: 'required', source: 'required' });
  app.close();
  writeFileSync(join(home, '.gitignore'), card.contextDir + '/source.md\n');
  // Git ignores only untracked files. Explicit exclusion of a registered new source must refuse.
  await assert.rejects(publishBackup({ filename, root: home }), /excluded/);
  rmSync(join(home, '.gitignore'));
  mkdirSync(join(home, '.cache')); writeFileSync(join(home, '.cache', 'data'), 'cache');
  writeFileSync(join(home, '.gitignore'), '.cache/\n');
  git('-C', home, 'add', '.gitignore'); git('-C', home, 'commit', '-m', 'Ignore cache');
  assert.equal(existsSync(join(home, '.cache/data')), true);
  git('-C', bare, 'config', 'receive.denyNonFastForwards', 'true');
  const first = await publishBackup({ filename, root: home });
  assert.equal(first.status, 'published', first.error);
  // A remote concurrent commit makes the next immutable local commit unpublishable.
  const other = join(dir, 'other'); git('clone', '--quiet', bare, other);
  git('-C', other, 'config', 'user.name', 'Fixture'); git('-C', other, 'config', 'user.email', 'fixture@example.test');
  writeFileSync(join(other, 'remote.md'), 'remote'); git('-C', other, 'add', 'remote.md'); git('-C', other, 'commit', '-m', 'Remote'); git('-C', other, 'push', 'origin', 'main');
  const second = await publishBackup({ filename, root: home, selectedPaths: ['.gitignore'] });
  assert.equal(second.status, 'partial'); assert.ok(second.commit); assert.equal(second.snapshotSaved, true);
  assert.equal(second.publicationConfirmed, false);
  assert.equal(git('-C', home, 'rev-parse', 'HEAD'), second.commit);
  assert.notEqual(git('-C', bare, 'rev-parse', 'main'), second.commit);
});

test('failed local ref update retains snapshot and two backup callers cannot both publish the same base', async t => {
  const { dir, filename } = state(t), home = join(dir, 'home'), bare = join(dir, 'remote.git');
  initializeWorkspace(filename, home);
  git('init', '--bare', '--quiet', bare); git('-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git('-C', home, 'remote', 'add', 'origin', bare);
  const app = createWorkspace(filename, false, home); app.memory.add('entry'); app.close();
  writeFileSync(join(home, '.git/refs/heads/main.lock'), 'locked');
  const failed = await publishBackup({ filename, root: home });
  assert.equal(failed.status, 'partial'); assert.equal(failed.snapshotSaved, true);
  assert.equal(failed.commit, undefined); assert.equal(failed.publicationConfirmed, false);
  assert.equal(existsSync(join(home, '.mypi-backup/state.sqlite3')), true);
  rmSync(join(home, '.git/refs/heads/main.lock'));
  const [one, two] = await Promise.all([publishBackup({ filename, root: home }), publishBackup({ filename, root: home })]);
  assert.equal([one, two].filter(x => x.status === 'published').length, 1);
  assert.equal([one, two].filter(x => x.status === 'partial').length, 1);
  assert.equal(git('-C', bare, 'rev-parse', 'main'), one.commit ?? two.commit);
});
