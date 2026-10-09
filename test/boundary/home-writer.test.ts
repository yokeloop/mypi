import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { HomeStatus } from '../../src/shared/home-writer.js';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
  const noDatabase = join(dir, 'absent/state.sqlite3');
  const status = () => executeCommand({ name: 'home_status' }, noDatabase, root) as Promise<HomeStatus>;
  const reconcile = () => executeCommand({ name: 'home_reconcile' }, noDatabase, root) as Promise<HomeStatus & { reconciled: boolean }>;
  const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
  const patch = (path: string, expected: string, text: string) => executeCommand({ name: 'home_document_patch', path, expected, text }, filename, root);
  const document = 'docs/notes/literal[1].md', original = '\ufefforiginal\r\n';
  contextFiles(root).create(document, original);
  chmodSync(join(root, document), 0o755);
  const protectedDocuments = ['inbox/original.md', 'source.md', 'projects/org/project/errors.md'];
  for (const path of protectedDocuments) contextFiles(root).create(path, 'preserved');
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0xff, 0]));
  contextGit(root).commit([document, ...protectedDocuments, 'binary.bin'], 'Fixture document targets');
  homeGit(root, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  const observed = await status();
  assert.deepEqual(observed, { head: homeGit(root, 'rev-parse', 'HEAD'), pending: null,
    remoteHead: homeGit(remote, 'rev-parse', 'refs/heads/main'), remoteOutcome: 'matches-local', needsAttention: false });
  assert.deepEqual(await reconcile(), { ...observed, reconciled: false });
  assert.equal(existsSync(join(dir, 'absent')), false, 'status/reconcile must not require or create a database');
  const add = (text: string) => executeCommand({ name: 'memory_add', text }, filename, root);
  const initial = homeGit(root, 'rev-parse', 'HEAD');
  const attributes = join(root, '.git/info/attributes'), configured = readFileSync(attributes);
  rmSync(attributes);
  assert.equal((await status()).needsAttention, true);
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

  await assert.rejects(patch(document, hash('stale'), 'must not write'), /preimage/);
  await assert.rejects(patch(document, hash(original), '\ud800'), /Unicode/);
  for (const path of protectedDocuments) {
    await assert.rejects(patch(path, hash('preserved'), 'rewrite'), /Immutable\/append-only/);
    assert.equal(readFileSync(join(root, path), 'utf8'), 'preserved');
  }
  await assert.rejects(patch('binary.bin', hash(Buffer.from([0xff, 0])), 'rewrite'), /encoded data/);
  assert.deepEqual(readFileSync(join(root, 'binary.bin')), Buffer.from([0xff, 0]));
  await assert.rejects(patch('absent.md', hash(''), 'must not create'), /existing tracked/);
  assert.equal(existsSync(join(root, 'absent.md')), false);
  writeFileSync(join(root, 'unknown.md'), 'unknown');
  await assert.rejects(patch('unknown.md', hash('unknown'), 'not adopted'), /existing tracked/);
  assert.equal(readFileSync(join(root, 'unknown.md'), 'utf8'), 'unknown');
  rmSync(join(root, 'unknown.md'));
  await assert.rejects(patch('cache/untouched', hash('ignored cache'), 'not adopted'), /existing tracked|Ignored/);
  assert.equal(readFileSync(join(root, document), 'utf8'), original);
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), initial);
  assert.equal(existsSync(marker), false);
  assert.throws(() => writer.run('document_patch', scope => {
    scope.declare([{ path: 'cache/untouched', expected: scope.preimage('cache/untouched'), adopt: true }]);
  }), /Ignored/);
  homeGit(root, 'update-index', '--assume-unchanged', '.gitignore');
  await assert.rejects(add('hidden state'), /index flags/);
  assert.match(homeGit(root, 'ls-files', '-v', '.gitignore'), /^h /, 'writer never clears unsupported flags');
  homeGit(root, 'update-index', '--no-assume-unchanged', '.gitignore');

  const replacement = '\ufeffexact replacement\r\nкириллица\n';
  const patched = await patch(document, hash(original), replacement) as { path: string; commit: string };
  assert.deepEqual(patched, { path: document, commit: homeGit(root, 'rev-parse', 'HEAD') });
  assert.deepEqual(readFileSync(join(root, document)), Buffer.from(replacement));
  assert.equal(lstatSync(join(root, document)).mode & 0o777, 0o755);
  assert.match(homeGit(root, 'ls-tree', 'HEAD', '--', document), /^100755 blob /);
  assert.equal(homeGit(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', patched.commit), document);
  assert.equal(homeGit(remote, 'rev-parse', 'refs/heads/main'), patched.commit);
  assert.deepEqual(await patch(document, hash(replacement), replacement), patched);
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), patched.commit);
  assert.equal(homeGit(remote, 'rev-parse', 'refs/heads/main'), patched.commit);
  assert.equal(existsSync(marker), false, 'no-op must not create a pending operation');
  const empty = await patch(document, hash(replacement), '') as { commit: string };
  assert.equal(readFileSync(join(root, document), 'utf8'), '');
  assert.equal(lstatSync(join(root, document)).mode & 0o777, 0o755);
  assert.match(homeGit(root, 'ls-tree', 'HEAD', '--', document), /^100755 blob /);
  assert.equal(homeGit(remote, 'rev-parse', 'refs/heads/main'), empty.commit);
  assert.equal(existsSync(join(root, 'MEMORY.md')), false, 'ordinary patch is not a memory entry');

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
  assert.equal((await status()).needsAttention, false);
  for (const path of ['MEMORY.md', homeGit(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', second),
    'projects/org/MEMORY.md', 'projects/org/notes/n.md', 'projects/org/project/MEMORY.md', 'projects/org/project/notes/n.md']) {
    await assert.rejects(patch(path, hash(''), 'rewrite'), /Managed memory\/notes/);
  }
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), second);
  assert.equal(existsSync(marker), false);

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
  const pending = (await status()).pending!, savedHead = homeGit(root, 'rev-parse', 'HEAD');
  assert.equal(pending.commit, savedHead);
  assert.deepEqual(pending.paths, [card!.contextDir + '/source.md', 'journal/2026-10.jsonl']);
  const journal = readFileSync(join(root, 'journal/2026-10.jsonl'));
  await assert.rejects(add('blocked by pending'), /Pending home operation/);
  await executeCommand({ name: 'project_add', identity: 'independent/project', code: 'IP' }, filename, root);
  assert.equal((await reconcile()).reconciled, false);
  assert.deepEqual(readFileSync(join(root, 'journal/2026-10.jsonl')), journal);
  renameSync(remote + '-unavailable', remote);
  // Model a push already reaching the destination before its confirmation was lost.
  homeGit(root, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  assert.equal((await reconcile()).reconciled, true);
  assert.equal(existsSync(marker), false);
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), savedHead);
  assert.deepEqual(readFileSync(join(root, 'journal/2026-10.jsonl')), journal);
  assert.equal((await executeCommand({ name: 'request_list' }, filename, root) as unknown[]).length, 1);

  const attachment = card!.contextDir + '/literal[1].bin';
  writeFileSync(join(root, attachment), Buffer.from([0xff, 0, 1]));
  await executeCommand({ name: 'request_progress', key: card!.key, text: 'Explicit reference', artifacts: [{ path: 'literal[1].bin' }] }, filename, root);
  assert.deepEqual(readFileSync(join(root, attachment)), Buffer.from([0xff, 0, 1]));
  const publishedHead = homeGit(root, 'rev-parse', 'HEAD');
  for (const path of [attachment, card!.contextDir + '/source.md', 'journal/2026-10.jsonl']) {
    const bytes = readFileSync(join(root, path));
    await assert.rejects(patch(path, hash(bytes), 'rewrite'), /Immutable\/append-only/);
    assert.deepEqual(readFileSync(join(root, path)), bytes);
  }
  assert.equal(homeGit(root, 'rev-parse', 'HEAD'), publishedHead);
  assert.equal(existsSync(marker), false);
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
