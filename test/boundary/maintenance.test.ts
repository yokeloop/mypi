import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { backupState, restoreState, verifyReferences } from '../../src/app/backup.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';

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
  const card = app.requests.create({ title: 'Backup', status: 'new', slug: 'backup', source: 'source\r\n' });
  app.requests.progress(card.key, 'artifact', [{ path: 'artifacts/result.md', text: 'evidence' }]);
  app.memory.add('before');
  const old = contextGit(root).head()!;
  app.memory.add('after');
  rmSync(join(root, 'MEMORY.md'));
  app.restoreContext('MEMORY.md', old);
  assert.deepEqual(app.memory.show().items.map(x => x.text), ['before']);
  app.close();
  const snapshot = join(dir, 'backup');
  await backupState(filename, snapshot, root);
  const restoredDB = join(dir, 'restored.sqlite3'), restoredRoot = join(dir, 'restored-home');
  restoreState(snapshot, restoredDB, restoredRoot);
  const restored = createWorkspace(restoredDB, true, restoredRoot);
  try {
    assert.equal(restored.requests.get(card.key).id, card.id);
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
  assert.throws(() => verifyReferences(filename, root), /ENOENT|Missing artifact/);
});
