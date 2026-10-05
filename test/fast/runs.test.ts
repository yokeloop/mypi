import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app/create-app.js';
import { workerCommand, relativeResource } from '../../src/app/worker-command.js';
import { deriveCommand } from '../../src/app/derive-command.js';
import { state } from '../support/state.js';

test('run binding persists, one active attempt owns a request/worktree, and exits never close requests', t => {
  const { filename } = state(t);
  let app = createApp(filename, false);
  const card = app.requests.create({ projectId: null, title: 'Task', slug: 'task', status: 'planning' }, () => {});
  const input = { id: 'a'.repeat(32), requestId: card.id, requestKey: 'REQ-1', sessionId: 'b'.repeat(32), worktree: '/work/one', baseRevision: 'c'.repeat(40) };
  assert.equal(app.runs.list(card.id).length, 0); // Card creation is not a launch.
  const run = app.runs.prepare(input);
  assert.equal(run.state, 'prepared'); assert.equal(run.sessionFile, null);
  assert.throws(() => app.runs.prepare({ ...input, id: 'd'.repeat(32) }), /UNIQUE/);
  assert.throws(() => app.runs.transition(run.id, 'prepared', 'running'), /transition/);
  app.runs.transition(run.id, 'prepared', 'starting', { pane: 'opaque-pane', tab: 'opaque-tab' });
  assert.throws(() => app.runs.transition(run.id, 'prepared', 'starting'), /changed/);
  app.runs.transition(run.id, 'starting', 'running', { invocation: 'e'.repeat(32) });
  app.close(); app = createApp(filename, false);
  try {
    assert.equal(app.runs.active(run.id).sessionId, input.sessionId);
    assert.equal(app.runs.get(run.id).pane, 'opaque-pane');
    app.runs.transition(run.id, 'running', 'stopping');
    assert.throws(() => app.runs.active(run.id), /not active/);
    app.runs.transition(run.id, 'stopping', 'stopped');
    assert.throws(() => app.runs.transition(run.id, 'stopped', 'running'), /transition/);
    const next = app.runs.prepare({ ...input, id: 'd'.repeat(32) });
    assert.equal(next.sessionId, run.sessionId);
    assert.equal(app.requests.get(card.id).status, 'planning');
    assert.equal(app.runs.list(card.id).length, 2);
  } finally { app.close(); }
});

test('worker commands bind scope before dispatch and deny file inputs, escapes and authority spoofing', () => {
  const grant = { requestKey: 'MP-5', contextDir: 'projects/one/proj/requests/MP-5-task', contextReads: ['MEMORY.md'] };
  assert.deepEqual(workerCommand(grant, 'request_show', {}), { name: 'request_show', key: 'MP-5' });
  assert.deepEqual(workerCommand(grant, 'journal_read', { limit: 3 }), { name: 'journal_read', scope: { type: 'request', key: 'MP-5' }, limit: 3 });
  assert.equal(workerCommand(grant, 'context_read', { path: 'MEMORY.md' }).name, 'context_read');
  assert.equal(workerCommand(grant, 'request_progress', { text: 'result', artifacts: [{ path: 'result.md', text: 'content' }] }).name, 'request_progress');
  for (const path of ['/etc/passwd', '../other', 'a/../b', 'a//b', 'a/.git/config', 'a\\b', 'a\0b']) assert.throws(() => relativeResource(path));
  for (const [name, args] of [
    ['request_show', { key: 'MP-6' }], ['request_show', { approved: true }],
    ['journal_read', { scope: 'all' }], ['journal_read', { limit: 101 }],
    ['context_read', { path: 'projects/one/proj/requests/MP-6-other/source.md' }],
    ['request_progress', { text: 'x', artifacts: [{ path: '../foreign', text: 'x' }] }],
    ['request_progress', { text: 'x', artifacts: [{ path: 'source.md', text: 'x' }] }],
    ['request_progress', { text: 'x', artifacts: [{ path: 'x', file: '/etc/passwd' }] }],
    ['request_status', { status: 'done' }], ['context_commit', { paths: ['MEMORY.md'] }],
    ['bootstrap', {}], ['run_start', {}], ['mint_token', { request: 'MP-5' }],
  ] as const) assert.throws(() => workerCommand(grant, name, args));
});

test('Derive proxy binds one artifact/workspace and denies foreign IDs, broad APIs, sharing and versionless writes', () => {
  const grant = { artifact: 'ownid123', workspace: 'workspace-own' };
  assert.deepEqual(deriveCommand(grant, 'derive_read', { format: 'html', version: 2 }),
    { name: 'read', arguments: { format: 'html', version: 2, short_id: 'ownid123', workspace: 'workspace-own' } });
  assert.deepEqual(deriveCommand(grant, 'derive_catch_up', {}),
    { name: 'catch_up', arguments: { short_id: 'ownid123', workspace: 'workspace-own' } });
  const edits = [{ old_str: 'one', new_str: 'two' }];
  assert.equal(deriveCommand(grant, 'derive_publish', { base_version: 2, edits }).arguments.short_id, 'ownid123');
  for (const [name, args] of [
    ['derive_read', { short_id: 'foreign1' }], ['derive_read', { workspace: 'foreign' }],
    ['derive_read', { uri: 'derive://private' }], ['derive_code', { code: 'tools.find({})' }],
    ['derive_stage', { target: 'api' }], ['derive_publish', { edits }],
    ['derive_publish', { base_version: 2, edits, link_role: 'editor' }],
    ['derive_publish', { base_version: 2, edits, approved: true }],
  ] as const) assert.throws(() => deriveCommand(grant, name, args));
});
