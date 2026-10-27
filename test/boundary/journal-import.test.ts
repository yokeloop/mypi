import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';

test('explicit legacy import preserves exact rows/files, empty input and replay; refuses changed or missing input', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  const app = createWorkspace(filename, false, root);
  try {
    app.projects.add('one/project', 'MP');
    const card = app.tasks.create({ project: 'one/project', title: 'Legacy', status: 'new', slug: 'legacy', source: 'original' });
    const artifact = card.contextDir + '/proof.md', log = 'journal/2026-01.jsonl', empty = 'journal/2026-02.jsonl';
    contextFiles(root).create(artifact, 'evidence');
    const entry = { at: '2026-01-01T00:00:00Z', scope: { type: 'task', key: card.key },
      event_type: 'note', text: 'same', artifacts: [artifact] };
    const bytes = Buffer.from(JSON.stringify(entry) + '\n' + JSON.stringify(entry) + '\n'
      + JSON.stringify({ ...entry, text: 'different\ntext' }) + '\n');
    contextFiles(root).create(log, bytes.toString('utf8'));
    contextFiles(root).create(empty, '');
    contextGit(root).commit([card.contextDir + '/source.md', artifact, log, empty], 'Publish legacy files');
    const rows = () => {
      const db = openDatabase(filename, true);
      try { return { journal: db.prepare('SELECT * FROM knowledge_journal ORDER BY id').all(),
        imports: db.prepare('SELECT * FROM knowledge_journal_imports ORDER BY path').all() }; }
      finally { db.close(); }
    };
    assert.deepEqual(app.importJournal(), { imported: 3 });
    assert.deepEqual(readFileSync(join(root, log)), bytes);
    assert.equal(readFileSync(join(root, empty)).length, 0);
    assert.deepEqual(app.history({ type: 'task', key: card.key }).map(e => [e.text, e.artifacts ?? []]),
      [['same', [artifact]], ['same', [artifact]], ['different\ntext', [artifact]], ['Task registered.', []]]);
    const saved = rows();
    assert.equal(saved.imports.length, 2);
    assert.deepEqual(app.importJournal(), { imported: 0 });
    assert.deepEqual(rows(), saved);
    writeFileSync(join(root, artifact), 'changed');
    assert.throws(() => app.tasks.progress(card.key, 'reuse', [{ path: 'proof.md' }]), /Registered file changed/);
    writeFileSync(join(root, artifact), 'evidence');
    writeFileSync(join(root, log), Buffer.concat([bytes, Buffer.from('broken\n')]));
    assert.throws(() => app.importJournal(), /Legacy journal changed after import/);
    assert.deepEqual(rows(), saved);
    writeFileSync(join(root, log), bytes);
    rmSync(join(root, empty));
    assert.throws(() => app.importJournal(), /Imported legacy journal missing: journal\/2026-02.jsonl/);
    assert.deepEqual(rows(), saved);
    contextFiles(root).create(empty, '');
    assert.deepEqual(app.importJournal(), { imported: 0 });
    assert.deepEqual(rows(), saved);
    const invalid = join(root, 'journal/2026-03.jsonl');
    contextFiles(root).create('journal/2026-03.jsonl', '\n');
    assert.throws(() => app.importJournal(), /journal\/2026-03.jsonl:1/);
    writeFileSync(invalid, 'broken\n');
    assert.throws(() => app.importJournal(), /journal\/2026-03.jsonl:1/);
    writeFileSync(invalid, 'broken');
    assert.throws(() => app.importJournal(), /journal\/2026-03.jsonl: incomplete final line/);
    assert.deepEqual(rows(), saved);
  } finally { app.close(); }
});
