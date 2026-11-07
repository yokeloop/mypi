import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournal } from '../../src/modules/knowledge/public.js';
import { sameScope } from '../../src/shared/scope.js';

test('journal validates envelope and applies overall ordering/limit even for unordered input', () => {
  const rows = [3, 1, 2].map(day => ({ at: '2026-10-0' + day + 'T00:00:00Z', scope: { type: 'global' }, event_type: 'note', text: String(day) }));
  const journal = createJournal({ append: () => '', entries: () => rows }, () => {}, sameScope, () => '2026-10-02T00:00:00Z');
  assert.deepEqual(journal.read({ type: 'global' }, { limit: 2 }).map(e => e.text), ['2', '3']);
  for (const scope of [{ type: 'global', key: null }, { type: 'all' }, [], { type: 'task', key: 'REQ-0' }]) {
    assert.throws(() => journal.record(scope as never, 'bad'));
  }
  assert.throws(() => journal.record({ type: 'global' }, ' '));
  assert.throws(() => journal.record({ type: 'global' }, 'text', 'note', ['../escape']));
  const commit = 'a'.repeat(40);
  assert.deepEqual(journal.record({ type: 'global' }, 't', 'note', [{ path: 'a.md', commit }]).artifacts, [{ path: 'a.md', commit }]);
  assert.throws(() => journal.record({ type: 'global' }, 't', 'note', [{ path: 'a.md', commit, extra: 1 } as never]), /Invalid artifact/);
  assert.throws(() => journal.record({ type: 'global' }, 't', 'note', [{ path: 'a.md', commit: 'abc' }]), /Invalid artifact/);
  assert.throws(() => journal.record({ type: 'global' }, 't', 'note', [{ path: '../x', commit }]), /Invalid artifact path/);
  assert.throws(() => journal.read('all', { from: '2026-02-30T00:00:00Z' }));
});

test('journal accepts each event type only in the scopes of its fact', () => {
  const journal = createJournal({ append: () => '', entries: () => [] }, () => {}, sameScope, () => '2026-10-02T00:00:00Z');
  const global = { type: 'global' } as const, org = { type: 'org', key: 'one' } as const;
  const project = { type: 'project', key: 'MP' } as const, task = { type: 'task', key: 'MP-1' } as const;
  const accepted = [
    [global, 'note'], [org, 'note'], [task, 'task_created'], [task, 'status_changed'], [task, 'title_changed'], [task, 'worktree_created'],
    [project, 'clone_prepared'], [task, 'session_opened'], [project, 'session_opened'], [org, 'session_opened'],
    [task, 'message_sent'], [project, 'message_sent'], [org, 'message_sent'],
  ] as const;
  for (const [scope, type] of accepted) assert.equal(journal.record(scope, 't', type).event_type, type);
  const rejected = [
    [project, 'task_created'], [project, 'title_changed'], [project, 'worktree_created'], [task, 'clone_prepared'], [org, 'clone_prepared'],
    [global, 'session_opened'], [global, 'message_sent'], [global, 'clone_prepared'], [task, 'bogus' as never],
  ] as const;
  for (const [scope, type] of rejected) assert.throws(() => journal.record(scope, 't', type), /Invalid event type\/scope/);
  assert.throws(() => journal.read('all', { type: 'bogus' as never }), /Invalid history filters/);
  assert.doesNotThrow(() => journal.read('all', { type: 'worktree_created' }));
});
