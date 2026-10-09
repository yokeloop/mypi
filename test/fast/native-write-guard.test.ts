import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guardNativeWrite, worktreeWriteCondition } from '../../src/app/native-write-guard.js';
import type { PiContextSelection } from '../../src/app/pi-context.js';
import { canonicalNativeToolPath, resolveNativeToolPath } from '../../src/infrastructure/filesystem/native-tool-path.js';
import { DEFAULT_GUARD_POLICY, normalizeGuardPolicy } from '../../src/modules/work-context/public.js';

test('native write guard matches native path spelling, canonical symlinks and hook responses', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-native-write-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const base = join(dir, 'base'), task = join(base, 'task'), foreign = join(dir, 'foreign');
  for (const root of [task, foreign]) mkdirSync(root, { recursive: true });
  writeFileSync(join(task, 'existing'), 'own');
  writeFileSync(join(foreign, 'existing'), 'foreign');
  symlinkSync(foreign, join(task, 'out'));
  symlinkSync(task, join(dir, 'alias'));
  symlinkSync(join(dir, 'missing'), join(task, 'dangling'));
  const workspace = { selectedRoot: task, baseRoot: base, selectedIsBase: false };
  const selection: PiContextSelection = { state: 'selected', data: { version: 1, cwd: task,
    context: { scope: { kind: 'project', project: 'one/a' }, worktreeRoot: task } } };
  let observations = 0;
  const warnings: string[] = [];
  const input = { toolName: 'write', path: 'existing', cwd: task, home: foreign, selection,
    configuration: { policy: DEFAULT_GUARD_POLICY }, observe: () => { observations++; return workspace; },
    warn: (message: string) => warnings.push(message) };
  const cases: readonly [string, string, boolean][] = [
    ['existing', join(task, 'existing'), false], ['new/deep/file', join(task, 'new/deep/file'), false],
    ['@existing', join(task, 'existing'), false], ['space\u202Fname', join(task, 'space name'), false],
    [join(dir, 'alias/new'), join(task, 'new'), false],
    ['~/existing', join(foreign, 'existing'), true], ['@~/new', join(foreign, 'new'), true],
    [pathToFileURL(join(foreign, 'new')).href, join(foreign, 'new'), true],
    ['../base-file', join(base, 'base-file'), true], ['out/existing', join(foreign, 'existing'), true],
    ['out/new/file', join(foreign, 'new/file'), true],
  ];
  for (const [path, canonical, blocked] of cases) {
    assert.equal(canonicalNativeToolPath(resolveNativeToolPath(path, task, foreign)), canonical, path);
    assert.equal(guardNativeWrite({ ...input, path })?.block === true, blocked, path);
  }
  assert.throws(() => canonicalNativeToolPath(join(task, 'dangling/new')));
  assert.equal(guardNativeWrite({ ...input, path: 'dangling/new' })?.block, true);
  assert.equal(worktreeWriteCondition(workspace, join(task, 'new')), 'own-task', 'task nested under base wins');
  assert.equal(worktreeWriteCondition({ ...workspace, selectedIsBase: true }, join(foreign, 'new')), 'base');
  assert.match(guardNativeWrite({ ...input, observe: () => { throw new Error('unavailable'); } })!.reason, /usable selected task worktree/);
  const missing: PiContextSelection = { state: 'selected', data: { version: 1, cwd: task,
    context: { scope: { kind: 'organization', organization: 'one' } } } };
  assert.equal(guardNativeWrite({ ...input, selection: missing })?.block, true);
  for (const toolName of ['write', 'edit']) {
    assert.equal(guardNativeWrite({ ...input, toolName, path: 'out/new', configuration: {
      policy: normalizeGuardPolicy({ version: 2, guards: { outsideWorktreeWrite: 'warn' } }),
    } }), undefined);
  }
  assert.equal(warnings.length, 2);
  assert(warnings.every(message => /outside the selected/.test(message)));
  const before = observations;
  for (const toolName of ['read', 'grep', 'find', 'bash', 'custom']) assert.equal(guardNativeWrite({ ...input, toolName }), undefined);
  for (const selection of [{ state: 'absent' }, { state: 'invalid' }, { state: 'cwd-mismatch' },
    { state: 'selected', data: { version: 1, cwd: task, context: { scope: { kind: 'unrestricted' } } } }] as const) {
    assert.equal(guardNativeWrite({ ...input, selection }), undefined);
    assert.deepEqual(guardNativeWrite({ ...input, selection, configuration: { error: 'bad policy' } }), { block: true, reason: 'bad policy' });
  }
  assert.equal(guardNativeWrite({ ...input, toolName: 'read', configuration: { error: 'bad policy' } }), undefined);
  assert.equal(observations, before, 'uncovered tools and unselected/unrestricted contexts need no Git observation');
});
