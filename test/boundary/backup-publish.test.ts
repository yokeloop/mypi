import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, renameSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { state } from '../support/state.js';
import { initializeWorkspace, createWorkspace } from '../../src/app/create-workspace.js';
import { publishBackup } from '../../src/app/backup.js';
import { backupGit } from '../../src/infrastructure/git/backup-git.js';
import { run } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';

function git(...args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function logicalState(filename: string) {
  const db = new Database(filename, { readonly: true });
  try {
    return Object.fromEntries(['organizations', 'projects', 'task_statuses', 'tasks', 'knowledge_journal',
      'knowledge_journal_imports', 'knowledge_file_fingerprints'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  } finally { db.close(); }
}

function staged(home: string): string {
  const entries = git('-C', home, 'ls-files', '--stage', '-z');
  return entries + '\n' + entries.split('\0').filter(Boolean).map(entry => {
    const oid = entry.split(/\s+/)[1]!;
    const blob = spawnSync('git', ['-C', home, 'cat-file', 'blob', oid], { encoding: 'buffer', timeout: 5000 });
    assert.equal(blob.status, 0);
    return oid + ':' + createHash('sha256').update(blob.stdout).digest('hex');
  }).join('\n');
}

test('published snapshot is exact, from fresh remote clone, keeps unrelated index and ignores caches', async t => {
  const { dir, filename } = state(t), home = join(dir, 'home'), bare = join(dir, 'remote.git');
  initializeWorkspace(filename, home);
  git('init', '--bare', '--quiet', bare);
  git('-C', home, 'remote', 'add', 'origin', bare);
  git('-C', home, 'config', 'user.name', 'Fixture'); git('-C', home, 'config', 'user.email', 'fixture@example.test');
  const app = createWorkspace(filename, false, home);
  app.memory.add('committed');
  app.projects.add('sample/engine', 'SAMPLE');
  app.statuses.addStatus('checking', false);
  app.journal({ type: 'global' }, 'duplicate'); app.journal({ type: 'global' }, 'duplicate');
  app.journal({ type: 'global' }, 'large-' + 'x'.repeat(1_200_000));
  const card = app.tasks.create({ title: 'Backup', status: 'new', slug: 'backup', source: 'source\r\n', project: 'sample/engine' });
  app.tasks.progress(card.key, 'artifact', [{ path: 'artifacts/result.md', text: 'evidence' }]);
  app.tasks.create({ title: 'Project', status: 'checking', slug: 'project', source: 'project source', project: 'sample/engine' });
  app.close();
  writeFileSync(join(home, 'MEMORY.md'), 'unselected edit\n');
  const chosen = Buffer.from('selected exact bytes\r\n' + 'z'.repeat(1_100_000) + '\r\n');
  writeFileSync(join(home, 'chosen.md'), chosen);
  writeFileSync(join(home, '.gitattributes'), 'chosen.md text eol=lf\n*.md ident filter=uppercase working-tree-encoding=UTF-8\n');
  git('-C', home, 'add', '.gitattributes'); git('-C', home, 'commit', '-m', 'Attributes');
  writeFileSync(join(home, 'chosen.md'), chosen);
  mkdirSync(join(home, 'pi'), { recursive: true });
  writeFileSync(join(home, 'USER-INSTRUCTIONS.md'), 'instructions');
  writeFileSync(join(home, 'old name.md'), 'old');
  symlinkSync('../USER-INSTRUCTIONS.md', join(home, 'pi/APPEND_SYSTEM.md'));
  git('-C', home, 'add', 'USER-INSTRUCTIONS.md', 'pi/APPEND_SYSTEM.md', 'old name.md'); git('-C', home, 'commit', '-m', 'Instruction link');
  renameSync(join(home, 'old name.md'), join(home, 'new name.md'));
  git('-C', home, 'add', '-A', '--', 'old name.md', 'new name.md');
  writeFileSync(join(home, 'chosen.md'), 'selected staged bytes'); git('-C', home, 'add', 'chosen.md');
  writeFileSync(join(home, 'chosen.md'), chosen);
  writeFileSync(join(home, 'unrelated.md'), 'staged bytes'); git('-C', home, 'add', 'unrelated.md');
  writeFileSync(join(home, 'unrelated.md'), 'unstaged bytes');
  const beforeDb = logicalState(filename);
  mkdirSync(join(home, '.cache')); writeFileSync(join(home, '.cache', 'work'), 'cache');
  writeFileSync(join(home, '.gitignore'), '.cache/\n');
  git('-C', home, 'add', '.gitignore');
  const beforeIndex = staged(home);
  const stagedUnrelated = git('-C', home, 'ls-files', '-s', 'unrelated.md');
  const preview = await run(parseCommand(['backup', '--publish', '--dry-run']), filename, home) as Awaited<ReturnType<typeof publishBackup>>;
  assert.equal(preview.status, 'preview');
  assert.equal(preview.snapshotSaved, false);
  assert.ok(preview.excludedPaths.includes('MEMORY.md'));
  assert.ok(preview.excludedPaths.includes('old name.md'));
  assert.ok(preview.excludedPaths.includes('new name.md'));
  assert.ok(preview.selectedPaths.includes(card.contextDir + '/source.md'));
  const result = await run(parseCommand(['backup', '--publish', '--file', 'chosen.md']), filename, home) as Awaited<ReturnType<typeof publishBackup>>;
  assert.equal(result.status, 'published', result.error);
  assert.equal(result.publicationConfirmed, true);
  assert.equal(git('-C', bare, 'rev-parse', 'refs/heads/main'), result.commit);
  assert.equal(git('-C', home, 'ls-files', '-s', 'unrelated.md'), stagedUnrelated);
  assert.equal(staged(home), beforeIndex);
  assert.equal(readFileSync(join(home, 'unrelated.md'), 'utf8'), 'unstaged bytes');
  assert.equal(readFileSync(join(home, 'new name.md'), 'utf8'), 'old');
  assert.deepEqual(backupGit(home).read(result.commit!, 'chosen.md'), chosen);
  assert.notDeepEqual(spawnSync('git', ['-C', home, 'show', ':chosen.md'], { encoding: 'buffer' }).stdout, chosen);
  assert.ok(backupGit(home).read(result.commit!, '.mypi-backup/state.sqlite3').length > 1024 * 1024);
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
  assert.deepEqual(readFileSync(join(restoredHome, 'chosen.md')), chosen);
  assert.deepEqual(logicalState(restoredDb), beforeDb);
  assert.equal(git('-C', restoredHome, 'ls-files', '-s', 'pi/APPEND_SYSTEM.md').startsWith('120000 '), true);
  assert.equal(readFileSync(join(restoredHome, 'pi/APPEND_SYSTEM.md'), 'utf8'), 'instructions');
  const existing = readFileSync(restoredDb);
  await assert.rejects(run(parseCommand(['restore', '--repository', clone, '--commit', result.commit!]), restoredDb, restoredHome), /absent/);
  assert.deepEqual(readFileSync(restoredDb), existing);
  git('-C', clone, 'config', 'user.name', 'Fixture'); git('-C', clone, 'config', 'user.email', 'fixture@example.test');
  for (const name of ['manifest.json', 'state.sqlite3']) {
    git('-C', clone, 'checkout', '--detach', result.commit!);
    writeFileSync(join(clone, '.mypi-backup', name), 'corrupt');
    git('-C', clone, 'add', '.mypi-backup/' + name);
    git('-C', clone, 'commit', '-m', 'Corrupt ' + name);
    const corrupted = git('-C', clone, 'rev-parse', 'HEAD');
    const targetDb = join(dir, name + '.sqlite3'), targetHome = join(dir, name + '-home');
    await assert.rejects(run(parseCommand(['restore', '--repository', clone, '--commit', corrupted]), targetDb, targetHome));
    assert.equal(existsSync(targetDb), false); assert.equal(existsSync(targetHome), false);
  }
});

test('push rejection retains exact local commit; required excluded files refuse, ignored cache does not block local backup', async t => {
  const { dir, filename } = state(t), home = join(dir, 'home'), bare = join(dir, 'remote.git');
  initializeWorkspace(filename, home);
  git('init', '--bare', '--quiet', bare); git('-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git('-C', home, 'remote', 'add', 'origin', bare);
  git('-C', home, 'config', 'user.name', 'Fixture'); git('-C', home, 'config', 'user.email', 'fixture@example.test');
  const app = createWorkspace(filename, false, home);
  app.memory.add('keep');
  app.projects.add('sample/engine', 'SAMPLE');
  const card = app.tasks.create({ project: 'sample/engine', title: 'Required', status: 'new', slug: 'required', source: 'required' });
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
  git('-C', home, 'remote', 'set-url', 'origin', join(dir, 'unreachable.git'));
  const unreachable = await publishBackup({ filename, root: home });
  assert.equal(unreachable.status, 'partial'); assert.equal(unreachable.snapshotSaved, true);
  assert.ok(unreachable.commit); assert.equal(unreachable.publicationConfirmed, false);
  assert.equal(existsSync(unreachable.snapshotPath!), true);
  assert.equal(git('-C', home, 'rev-parse', 'HEAD'), unreachable.commit);
});

test('push releases writer lock, pushes captured commit despite HEAD advance, inspects accepted-but-errored push', async t => {
  const { dir, filename } = state(t), home = join(dir, 'home'), bare = join(dir, 'remote.git');
  initializeWorkspace(filename, home);
  const app = createWorkspace(filename, false, home); app.memory.add('baseline'); app.close();
  git('init', '--bare', '--quiet', bare); git('-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git('-C', home, 'remote', 'add', 'origin', bare);
  const realGit = '/usr/bin/git';
  const gitVersion = spawnSync(realGit, ['--version'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(gitVersion.status, 0, gitVersion.error?.message ?? gitVersion.stderr);
  const wrapperDir = join(dir, 'bin'); mkdirSync(wrapperDir);
  const counter = join(dir, 'push-count');
  const writer = join(dir, 'writer.mjs');
  writeFileSync(writer, `import { createWorkspace } from ${JSON.stringify(new URL('../../src/app/create-workspace.js', import.meta.url).href)};\n` +
    `const app = createWorkspace(${JSON.stringify(filename)}, false, ${JSON.stringify(home)});\n` +
    `app.journal({ type: 'global' }, 'committed during push'); app.close();\n`);
  const wrapper = join(wrapperDir, 'git');
  writeFileSync(wrapper, '#!/bin/sh\n' +
    'if [ "$1" = "--literal-pathspecs" ]; then\n' +
    '  for arg in "$@"; do if [ "$arg" = "push" ]; then\n' +
    `    echo push >> ${JSON.stringify(counter)}\n` +
    `    node ${JSON.stringify(writer)} || exit 67\n` +
    `    ${JSON.stringify(realGit)} -C ${JSON.stringify(home)} -c user.name=Fixture -c user.email=fixture@example.test commit --allow-empty -qm 'HEAD advanced during push' || exit 68\n` +
    `    ${JSON.stringify(realGit)} "$@" || exit 69\n` +
    '    echo accepted-but-client-error >&2; exit 70\n' +
    '  fi; done\nfi\n' + `${JSON.stringify(realGit)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = wrapperDir + ':' + previousPath;
    const result = await publishBackup({ filename, root: home });
    assert.equal(result.status, 'published', result.error);
    assert.match(result.error ?? '', /accepted-but-client-error/);
    assert.equal(result.snapshotSaved, true); assert.equal(result.publicationConfirmed, true);
    assert.equal(git('-C', bare, 'rev-parse', 'main'), result.commit);
    assert.notEqual(git('-C', home, 'rev-parse', 'HEAD'), result.commit);
    assert.equal(readFileSync(counter, 'utf8').trim(), 'push');
    const db = logicalState(filename);
    assert.ok((db.knowledge_journal as { text: string }[]).some(row => row.text === 'committed during push'));
    assert.ok(!(db.knowledge_journal as { text: string }[]).some(row => row.text === 'backup published'));
    process.env.PATH = previousPath;
    git('-C', home, 'push', 'origin', result.commit! + ':refs/heads/main');
    assert.equal(git('-C', bare, 'rev-parse', 'main'), result.commit);
    assert.equal(readFileSync(counter, 'utf8').trim(), 'push');
  } finally { process.env.PATH = previousPath; }
});

test('cooperating writer at snapshot boundary yields honest refusal rather than mixed success', async t => {
  const { dir, filename } = state(t), home = join(dir, 'home'), bare = join(dir, 'remote.git');
  initializeWorkspace(filename, home);
  const app = createWorkspace(filename, false, home); app.memory.add('baseline'); app.close();
  git('init', '--bare', '--quiet', bare); git('-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git('-C', home, 'remote', 'add', 'origin', bare);
  const ready = join(dir, 'writer-ready'), helper = join(dir, 'lock.mjs');
  writeFileSync(helper, `import Database from ${JSON.stringify(import.meta.resolve('better-sqlite3'))};\n` +
    `import { writeFileSync } from 'node:fs';\n` +
    `const db = new Database(${JSON.stringify(filename)}); db.exec('BEGIN IMMEDIATE');\n` +
    `writeFileSync(${JSON.stringify(ready)}, 'locked'); setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, 1500);\n`);
  const writer = spawn(process.execPath, [helper], { stdio: ['ignore', 'ignore', 'pipe'] });
  const finished = new Promise<number | null>(resolve => writer.on('exit', resolve));
  try {
    for (let i = 0; i < 100 && !existsSync(ready); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(existsSync(ready), true);
    const result = await publishBackup({ filename, root: home });
    assert.equal(result.status, 'partial'); assert.equal(result.snapshotSaved, false);
    assert.equal(result.commit, undefined); assert.equal(result.publicationConfirmed, false);
    assert.equal(existsSync(join(home, '.mypi-backup/state.sqlite3')), false);
  } finally {
    const exit = await finished;
    assert.equal(exit, 0);
  }
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
