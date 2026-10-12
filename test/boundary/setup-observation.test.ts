import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { browseSetupDirectory, observeSetup, validateSetupChoice } from '../../src/app/setup-observation.js';

test('setup observation proposes only direct checkout and legacy candidates without writes', t => {
  const root = mkdtempSync(join(tmpdir(), 'mypi-observe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(observeSetup(root).status, 'unconfigured');
  assert.deepEqual(observeSetup(root).homeCandidates.map(item => item.path), [join(root, 'home')]);
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  mkdirSync(join(root, 'home'));
  assert.equal(observeSetup(root).homeCandidates[0]?.kind, 'occupied'); // Nested in engine Git is not its own home.
  mkdirSync(join(root, 'home/.git'));
  assert.equal(observeSetup(root).homeCandidates[0]?.kind, 'occupied'); // Fake metadata is not a repository.
  rmSync(join(root, 'home/.git'), { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', join(root, 'home')]).status, 0);
  mkdirSync(join(root, 'home/pi'));
  symlinkSync('home/pi', join(root, '.pi'));
  assert.equal(observeSetup(root).homeCandidates[0]?.kind, 'eligible');
  writeFileSync(join(root, '.mypi-local.json'), '{invalid');
  assert.equal(observeSetup(root).status, 'invalid');
  assert.equal(observeSetup(root).problem?.code, 'binding-invalid');
  assert.equal(observeSetup(root).problem?.field, 'binding');
  writeFileSync(join(root, '.mypi-local.json'), JSON.stringify({ version: 1, engineRoot: '/moved',
    homeRoot: join(root, 'home'), database: join(root, 'db'), stateRoot: join(root, 'runtime') }));
  assert.equal(observeSetup(root).status, 'invalid');
  rmSync(join(root, '.mypi-local.json'));
  symlinkSync('missing-binding', join(root, '.mypi-local.json'));
  assert.equal(observeSetup(root).status, 'invalid');
  assert.equal(validateSetupChoice(root, { homeMode: 'new', homeRoot: join(root, 'home') })?.code, 'occupied');
});
test('early path checks expose state and DB conflicts without applying', t => {
  const root = mkdtempSync(join(tmpdir(), 'mypi-early-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const external = mkdtempSync(join(tmpdir(), 'mypi-state-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  writeFileSync(join(external, 'occupied'), 'keep');
  assert.equal(validateSetupChoice(root, { stateRoot: join(external, 'occupied') })?.field, 'stateRoot');
  assert.equal(validateSetupChoice(root, { databaseMode: 'new', database: join(external, 'occupied') })?.code, 'occupied');
  assert.equal(validateSetupChoice(root, { database: join(external, 'runtime'), stateRoot: join(external, 'runtime') })?.field, 'database');
  assert.equal(validateSetupChoice(root, { stateRoot: join(root, 'state') })?.field, 'stateRoot');
});
test('single-directory browsing exposes pagination, unicode entries, broken link and errors', t => {
  const root = mkdtempSync(join(tmpdir(), 'mypi-browse-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'папка'));
  writeFileSync(join(root, ' spaced.txt'), '');
  symlinkSync('missing', join(root, 'broken'));
  const first = browseSetupDirectory(root, '', 0, 1);
  assert.equal(first.total, 3); assert.equal(first.nextOffset, 1);
  assert.equal(browseSetupDirectory(root, '', 1, 10).entries.length, 2);
  assert.equal(browseSetupDirectory(root, 'пап', 0, 10).entries[0]?.kind, 'directory');
  symlinkSync('папка', join(root, 'folder-link'));
  assert.equal(browseSetupDirectory(root, 'folder-link').entries[0]?.targetKind, 'directory');
  assert(browseSetupDirectory(root, 'broken').entries[0]?.error);
  assert(browseSetupDirectory(join(root, 'missing')).error);
});
