import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeCommand } from '../../src/app/execute-command.js';
import { createHomeWriter } from '../../src/app/home-writer.js';
import { createWorkspace } from '../../src/app/create-workspace.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';
import { PartialError } from '../../src/shared/context.js';
import { state } from '../support/state.js';
import { configureHome, homeGit } from '../support/home.js';

test('managed home exact writes preserve conflicts and reconcile publication without a second mutation', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  const { remote } = configureHome(root), writer = createHomeWriter(root);
  const marker = join(root, '.git/mypi-home-pending.json');
  const add = (text: string) => executeCommand({ name: 'memory_add', text }, filename, root);
  const initial = homeGit(root, 'rev-parse', 'HEAD');
  const attributes = join(root, '.git/info/attributes'), configured = readFileSync(attributes);
  rmSync(attributes);
  assert.equal(writer.status().needsAttention, true);
  assert.equal(existsSync(attributes), false, 'status must not repair missing Git attributes');
  await assert.rejects(add('missing setup'), /configured private Git attributes/);
  assert.equal(existsSync(attributes), false, 'managed preflight must not repair missing setup');
  assert.equal(existsSync(marker), false);
  writeFileSync(attributes, configured); // Explicit disposable-fixture setup restoration.
  mkdirSync(join(root, 'cache')); writeFileSync(join(root, 'cache/untouched'), 'ignored cache');
  writeFileSync(join(root, 'unrelated.md'), 'keep');
  await assert.rejects(add('forbidden'), /Unexplained/);
  assert.equal(existsSync(join(root, 'MEMORY.md')), false);
  assert.equal(existsSync(marker), false, 'preflight rejection is not an unfinished mutation');
  assert.equal(readFileSync(join(root, 'unrelated.md'), 'utf8'), 'keep');
  homeGit(root, 'add', '--', 'unrelated.md');
  const index = homeGit(root, 'ls-files', '--stage');
  await assert.rejects(add('still forbidden'), /Staged/);
  assert.equal(homeGit(root, 'ls-files', '--stage'), index);
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), initial);
  homeGit(root, 'reset', '--quiet', 'HEAD', '--', 'unrelated.md'); rmSync(join(root, 'unrelated.md'));

  assert.throws(() => writer.run('document_patch', scope => {
    scope.declare([{ path: 'ordinary.md', expected: 'a'.repeat(64) }]);
    scope.beforeEffect(); contextFiles(root).create('ordinary.md', 'must not exist');
  }), /preimage/);
  assert.equal(existsSync(join(root, 'ordinary.md')), false);
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), initial);
  assert.equal(existsSync(marker), false);
  assert.throws(() => writer.run('document_patch', scope => {
    scope.declare([{ path: 'cache/untouched', expected: scope.preimage('cache/untouched'), adopt: true }]);
  }), /Ignored/);
  homeGit(root, 'update-index', '--assume-unchanged', '.gitignore');
  await assert.rejects(add('hidden state'), /index flags/);
  assert.match(homeGit(root, 'ls-files', '-v', '.gitignore'), /^h /, 'writer never clears unsupported flags');
  homeGit(root, 'update-index', '--no-assume-unchanged', '.gitignore');

  await add('first');
  const first = homeGit(root, 'rev-parse', 'HEAD');
  assert.equal(homeGit(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', first), 'MEMORY.md');
  await executeCommand({ name: 'note_add', title: 'Second writer', body: { text: 'second' } }, filename, root);
  const second = homeGit(root, 'rev-parse', 'HEAD');
  assert.equal(homeGit(root, 'show', '-s', '--format=%P', second), first);
  assert.match(homeGit(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', second), /^notes\/[^\n]+\.md$/);
  assert.equal(homeGit(remote, 'rev-parse', 'refs/heads/main'), second);
  assert.equal(readFileSync(join(root, 'cache/untouched'), 'utf8'), 'ignored cache');
  assert.equal(existsSync(marker), false);
  assert.equal(writer.status().needsAttention, false);

  // Real post-mutation transport loss, confined to this disposable local origin.
  // The same scoped composition is used by executeCommand; no production failure hook.
  let card: ReturnType<ReturnType<typeof createWorkspace>['requests']['create']> | undefined;
  assert.throws(() => writer.run('request_create', scope => {
    const app = createWorkspace(filename, false, root, () => '2026-10-08T00:00:00.000Z', scope);
    try {
      card = app.requests.create({ title: 'Saved', status: 'new', slug: 'saved', source: 'exact source\r\n' });
      renameSync(remote, remote + '-unavailable');
      return card;
    } finally { app.close(); }
  }), error => {
    assert(error instanceof PartialError);
    assert.deepEqual(error.saved, ['database', 'context', 'git']);
    assert.deepEqual(error.missing, ['confirmed home publication']);
    assert.equal(error.requestId, card!.id);
    assert.equal(error.home!.pending.phase, 'publishing');
    assert.equal(error.home!.remoteOutcome, 'unknown');
    assert.equal(error.home!.needsAttention, true);
    return true;
  });
  const pending = writer.status().pending!, savedHead = homeGit(root, 'rev-parse', 'HEAD');
  assert.equal(pending.commit, savedHead);
  assert.deepEqual(pending.paths, [card!.contextDir + '/source.md', 'journal/2026-10.jsonl']);
  const journal = readFileSync(join(root, 'journal/2026-10.jsonl'));
  await assert.rejects(add('blocked by pending'), /Pending home operation/);
  await executeCommand({ name: 'project_add', identity: 'independent/project', code: 'IP' }, filename, root);
  assert.equal(writer.reconcile().reconciled, false);
  assert.deepEqual(readFileSync(join(root, 'journal/2026-10.jsonl')), journal);
  renameSync(remote + '-unavailable', remote);
  // Model a push already reaching the destination before its confirmation was lost.
  homeGit(root, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  assert.equal(writer.reconcile().reconciled, true);
  assert.equal(existsSync(marker), false);
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), savedHead);
  assert.deepEqual(readFileSync(join(root, 'journal/2026-10.jsonl')), journal);
  assert.equal((await executeCommand({ name: 'request_list' }, filename, root) as unknown[]).length, 1);

  const attachment = card!.contextDir + '/literal[1].bin';
  writeFileSync(join(root, attachment), Buffer.from([0xff, 0, 1]));
  await executeCommand({ name: 'request_progress', key: card!.key, text: 'Explicit reference', artifacts: [{ path: 'literal[1].bin' }] }, filename, root);
  assert.deepEqual(readFileSync(join(root, attachment)), Buffer.from([0xff, 0, 1]));
  const publishedHead = homeGit(root, 'rev-parse', 'HEAD');
  writeFileSync(join(root, attachment), Buffer.from([1, 2, 3]));
  await assert.rejects(executeCommand({ name: 'request_progress', key: card!.key, text: 'No rewrite', artifacts: [{ path: 'literal[1].bin' }] }, filename, root), /Immutable/);
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), publishedHead);
  assert.equal(existsSync(marker), false);
  writeFileSync(join(root, attachment), Buffer.from([0xff, 0, 1]));
  await executeCommand({ name: 'request_status', key: card!.key, status: 'new', reason: 'unchanged' }, filename, root);
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), publishedHead);
  assert.equal(existsSync(marker), false, 'successful no-op must not strand pending state');
  await assert.rejects(executeCommand({ name: 'request_status', key: card!.key, status: 'absent', reason: 'invalid' }, filename, root), /status/);
  assert.equal(existsSync(marker), false, 'known synchronous transaction validation rollback is not pending');

  // Explicit maintenance remains uncoordinated; it does not enable offline accumulation.
  contextFiles(root).create('maintenance.md', 'manual');
  contextGit(root).commit(['maintenance.md'], 'Unpublished maintenance');
  await assert.rejects(add('not offline'), /already match/);
  assert.equal(existsSync(marker), false);
});
