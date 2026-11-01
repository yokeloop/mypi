import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { backupState } from '../../src/app/backup.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { sqliteJournalStore } from '../../src/modules/knowledge/public.js';
import { fileFingerprint } from '../../src/app/file-fingerprints.js';

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-C', root, ...args], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('journal artifacts point at home commits: files stay editable, versions stay readable and backup checks the history', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  const app = createWorkspace(filename, false, root);
  try {
    app.projects.add('one/project', 'MP');
    const card = app.tasks.create({ project: 'one/project', title: 'Versions', status: 'new', slug: 'versions', source: 'source' });
    const source = card.contextDir + '/source.md', plan = card.contextDir + '/plan.md';
    app.complete([source], 'Publish source');
    app.tasks.progress(card.key, 'plan', [{ path: 'plan.md', text: 'v1' }]);
    const history = async () => await executeCommand({ name: 'journal_read', scope: { type: 'task', key: card.key } }, filename, root) as { text: string; artifacts?: unknown[] }[];
    const recorded = (await history()).at(-1)!.artifacts as { path: string; commit: string }[];
    const commit = git(root, 'rev-parse', 'HEAD');
    assert.deepEqual(recorded, [{ path: plan, commit }]);
    assert.equal(git(root, 'status', '--porcelain'), '');

    writeFileSync(join(root, plan), 'v2');
    app.complete([plan], 'Edit plan');
    assert.equal((await executeCommand({ name: 'context_read', path: plan }, filename, root) as { text: string }).text, 'v2');
    assert.deepEqual(await executeCommand({ name: 'context_read', path: plan, revision: commit }, filename, root), { path: plan, revision: commit, text: 'v1' });

    writeFileSync(join(root, source), 'corrected source');
    app.complete([source], 'Correct source');

    assert.equal((await backupState(filename, join(dir, 'edited'), root)).status, 'ok');
    rmSync(join(root, plan));
    app.complete([plan], 'Remove plan');
    assert.equal((await backupState(filename, join(dir, 'removed'), root)).status, 'ok');
    assert.equal((await executeCommand({ name: 'context_read', path: plan, revision: commit }, filename, root) as { text: string }).text, 'v1');

    const old = card.contextDir + '/old.md';
    contextFiles(root).create(old, 'old proof');
    const db = openDatabase(filename);
    try {
      sqliteJournalStore(db).append({ at: '2026-01-01T00:00:00.000Z', scope: { type: 'task', key: card.key }, event_type: 'note', text: 'old artifact', artifacts: [old] });
      sqliteJournalStore(db).saveFingerprint(fileFingerprint(contextFiles(root), old, '2026-01-01T00:00:00.000Z'));
    } finally { db.close(); }
    app.complete([old], 'Publish old artifact');
    assert.deepEqual((await history()).find(e => e.text === 'old artifact')!.artifacts, [old]);
    assert.equal((await backupState(filename, join(dir, 'old'), root)).status, 'ok');
    writeFileSync(join(root, old), 'rewritten');
    assert.throws(() => app.complete([old], 'Rewrite old artifact'), /Registered file changed/);
    writeFileSync(join(root, old), 'old proof');

    const orphan = git(root, 'commit-tree', git(root, 'rev-parse', 'HEAD^{tree}'), '-m', 'orphan');
    const write = openDatabase(filename);
    try {
      sqliteJournalStore(write).append({ at: '2026-01-02T00:00:00.000Z', scope: { type: 'task', key: card.key }, event_type: 'note', text: 'orphan', artifacts: [{ path: source, commit: orphan }] });
    } finally { write.close(); }
    await assert.rejects(backupState(filename, join(dir, 'orphan'), root), new RegExp('Unresolvable artifact reference: ' + source + '@' + orphan));
    const zero = openDatabase(filename);
    try {
      zero.prepare("UPDATE knowledge_journal SET artifacts_json = ? WHERE text = 'orphan'").run(JSON.stringify([{ path: source, commit: '0'.repeat(40) }]));
    } finally { zero.close(); }
    await assert.rejects(backupState(filename, join(dir, 'zero'), root), /Unresolvable artifact reference/);
  } finally { app.close(); }
});
