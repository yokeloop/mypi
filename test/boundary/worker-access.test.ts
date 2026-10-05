import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { createApp } from '../../src/app/create-app.js';
import { workerAccess } from '../../src/app/worker-access.js';

test('scoped application dispatch writes only its real task and rechecks revocation for queued calls', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home'), checkout = join(dir, 'checkout');
  mkdirSync(checkout); initializeWorkspace(filename, root);
  const app = createWorkspace(filename, false, root);
  app.projects.add('one/project', 'MP', checkout);
  const own = app.requests.create({ project: 'one/project', title: 'Own', status: 'planning', slug: 'own', source: 'own source' });
  const foreign = app.requests.create({ project: 'one/project', title: 'Foreign', status: 'planning', slug: 'foreign', source: 'foreign secret' });
  app.close();
  const db = createApp(filename, false); t.after(() => db.close());
  const id = 'a'.repeat(32);
  db.runs.prepare({ id, requestId: own.id, requestKey: own.key, sessionId: 'b'.repeat(32), worktree: checkout, baseRevision: 'c'.repeat(40) });
  db.runs.transition(id, 'prepared', 'starting'); db.runs.transition(id, 'starting', 'running');
  const call = workerAccess(filename, id, root);
  await call('request_progress', { text: 'own outcome', artifacts: [{ path: 'proof.txt', text: 'own proof' }] });
  assert.equal(readFileSync(join(root, own.contextDir, 'proof.txt'), 'utf8'), 'own proof');
  assert.equal(readFileSync(join(root, foreign.contextDir, 'source.md'), 'utf8'), 'foreign secret');
  await assert.rejects(call('context_read', { path: foreign.contextDir + '/source.md' }), /denied/);
  await assert.rejects(call('request_show', { key: foreign.key }), /Unsupported/);
  const pending = call('request_progress', { text: 'must never be appended' });
  db.runs.transition(id, 'running', 'stopping');
  await assert.rejects(pending, /not active/);
  const after = createWorkspace(filename, true, root);
  try { assert.equal(after.history({ type: 'request', key: own.key }).some(e => e.text === 'must never be appended'), false); }
  finally { after.close(); }
  assert.equal(db.requests.get(own.id).status, 'planning');
});
