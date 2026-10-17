import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';

test('explicit legacy import keeps duplicate source lines, checks replay bytes and refuses changed published files', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  const app = createWorkspace(filename, false, root);
  try {
    const card = app.requests.create({ title: 'Legacy', status: 'new', slug: 'legacy', source: 'original' });
    const artifact = card.contextDir + '/proof.md', log = 'journal/2026-01.jsonl';
    contextFiles(root).create(artifact, 'evidence');
    const entry = { at: '2026-01-01T00:00:00Z', scope: { type: 'request', key: card.key },
      event_type: 'note', text: 'same', artifacts: [artifact] };
    contextFiles(root).create(log, JSON.stringify(entry) + '\n' + JSON.stringify(entry) + '\n');
    contextGit(root).commit([card.contextDir + '/source.md', artifact, log], 'Publish legacy files');
    assert.deepEqual(app.importJournal(), { imported: 2 });
    assert.deepEqual(app.importJournal(), { imported: 0 });
    assert.equal(app.history({ type: 'request', key: card.key }).length, 3);
    writeFileSync(join(root, artifact), 'changed');
    assert.throws(() => app.requests.progress(card.key, 'reuse', [{ path: 'proof.md' }]), /Registered file changed/);
    writeFileSync(join(root, artifact), 'evidence');
    const before = readFileSync(join(root, log));
    writeFileSync(join(root, log), Buffer.concat([before, Buffer.from('broken\n')]));
    assert.throws(() => app.importJournal(), /Legacy journal changed after import/);
    assert.equal(app.history({ type: 'request', key: card.key }).length, 3);
    writeFileSync(join(root, log), before);
    contextFiles(root).create('journal/2026-02.jsonl', 'broken\n');
    assert.throws(() => app.importJournal(), /journal\/2026-02.jsonl:1/);
    assert.equal(app.history('all').length, 3);
  } finally { app.close(); }
});
