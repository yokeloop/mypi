import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { backupState, restoreState, verifyReferences } from '../../src/app/backup.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { contextGit, gitVersions } from '../../src/infrastructure/git/context-git.js';

test('backup uses real SQLite snapshot and Git bundle; restore validates source/artifact links and refuses overwrite/corruption', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  await backupState(filename, join(dir, 'db-only-backup'), root);
  assert.equal(existsSync(root), false);
  restoreState(join(dir, 'db-only-backup'), join(dir, 'db-only.sqlite3'), join(dir, 'db-only-home'));
  initializeWorkspace(filename, root);
  const app = createWorkspace(filename, false, root);
  // Tracked attributes must not normalize original CRLF bytes in a restored checkout.
  contextFiles(root).create('.gitattributes', '*.md text eol=lf\n');
  app.complete(['.gitattributes'], 'Fixture attributes');
  app.projects.add('one/project', 'MP');
  const card = app.tasks.create({ project: 'one/project', title: 'Backup', status: 'new', slug: 'backup', source: 'source\r\n' });
  app.tasks.progress(card.key, 'artifact', [{ path: 'artifacts/result.md', text: 'evidence' }]);
  contextFiles(root).create('INDEX.md', 'before\n');
  app.complete(['INDEX.md'], 'Add the global entry');
  const old = contextGit(root).head()!;
  writeFileSync(join(root, 'INDEX.md'), 'after\n');
  app.complete(['INDEX.md'], 'Update the global entry');
  rmSync(join(root, 'INDEX.md'));
  app.restoreContext('INDEX.md', old);
  assert.equal(app.read('INDEX.md'), 'before\n');
  app.complete([card.contextDir + '/source.md', card.contextDir + '/artifacts/result.md'], 'Publish saved files for backup');
  contextFiles(root).create('.gitignore', '.cache/\n');
  app.complete(['.gitignore'], 'Ignore cache');
  mkdirSync(join(root, '.cache')); writeFileSync(join(root, '.cache', 'ignored'), 'runtime cache');
  app.close();
  const snapshot = join(dir, 'backup');
  await backupState(filename, snapshot, root);
  const restoredDB = join(dir, 'restored.sqlite3'), restoredRoot = join(dir, 'restored-home');
  restoreState(snapshot, restoredDB, restoredRoot);
  assert.equal(existsSync(join(restoredRoot, '.cache', 'ignored')), false);
  assert.equal(readFileSync(join(root, '.cache', 'ignored'), 'utf8'), 'runtime cache');
  const restored = createWorkspace(restoredDB, true, restoredRoot);
  try {
    assert.equal(restored.tasks.get(card.key).id, card.id);
    assert.equal(restored.read(card.contextDir + '/source.md'), 'source\r\n');
    assert.equal(restored.history('all').length, 2);
    assert.equal(restored.read(card.contextDir + '/artifacts/result.md'), 'evidence');
  } finally { restored.close(); }
  const before = readFileSync(restoredDB);
  assert.throws(() => restoreState(snapshot, restoredDB, restoredRoot), /absent/);
  assert.deepEqual(readFileSync(restoredDB), before);
  writeFileSync(join(snapshot, 'state.sqlite3'), 'corrupt');
  assert.throws(() => restoreState(snapshot, join(dir, 'bad.sqlite3'), join(dir, 'bad-home')), /checksum/);
  assert.equal(existsSync(join(dir, 'bad.sqlite3')), false);
  rmSync(join(root, card.contextDir, 'artifacts/result.md'));
  await assert.rejects(backupState(filename, join(dir, 'missing-backup'), root), /Dirty/);
  assert.doesNotThrow(() => verifyReferences(filename, root, gitVersions(root, contextGit(root).head())));
});

test('project and org remove report remaining home folders and leave them in place', async t => {
  const { dir, filename } = state(t);
  const root = join(dir, 'home');
  mkdirSync(join(root, 'projects', 'one', 'project'), { recursive: true });
  const app = createApp(filename, false);
  let id: number, other: number;
  try {
    id = app.projects.add('one/project', 'MP').id;
    other = app.projects.add('two/project', 'YM').id;
  } finally { app.close(); }
  assert.deepEqual(await executeCommand({ name: 'project_remove', identity: 'one/project', expectedCode: 'MP' }, filename, root),
    { removed: { project: { id, org: 'one', slug: 'project', code: 'MP', checkoutPath: null, repository: null } }, homeFolder: 'projects/one/project' });
  assert.deepEqual(await executeCommand({ name: 'org_remove', org: 'one' }, filename, root),
    { removed: { organization: 'one' }, homeFolder: 'projects/one' });
  assert(existsSync(join(root, 'projects', 'one', 'project')));
  assert.deepEqual(await executeCommand({ name: 'project_remove', identity: 'two/project', expectedCode: 'YM' }, filename, root),
    { removed: { project: { id: other, org: 'two', slug: 'project', code: 'YM', checkoutPath: null, repository: null } }, homeFolder: null });
  assert.deepEqual(await executeCommand({ name: 'org_remove', org: 'two' }, filename, root),
    { removed: { organization: 'two' }, homeFolder: null });
});
