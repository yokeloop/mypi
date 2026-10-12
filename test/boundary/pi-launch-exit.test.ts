import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { herdrPiCommand } from '../../src/app/herdr.js';
import { awaitNativePiStartup } from '../../src/app/native-pi-readiness.js';
import type { Installation } from '../../src/app/installation.js';
import type { SessionList } from '../../src/app/session-cards.js';
import { preparePiExitMarker, readPiExitMarker } from '../../src/infrastructure/filesystem/pi-launch-exit.js';

test('Herdr command records direct Pi exit without masking status or touching the enclosing shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-launch-boundary-'));
  try {
    const pi = join(dir, 'pi');
    const args = join(dir, 'args');
    writeFileSync(pi, `#!/bin/sh\nprintf '%s\\n' "$*" > '${args}'\nexit 17\n`, { mode: 0o755 });
    const exitPath = preparePiExitMarker(join(dir, 'sessions'), 'bdbb6ae3-68d5-4335-8df7-79f4806e22ee');
    const command = herdrPiCommand({ cwd: dir, args: ['--probe'] }, pi, join(dir, 'extension.ts'), {}, exitPath);
    const stdout = execFileSync('/bin/sh', ['-c', `${command}; printf 'shell-alive'`], { cwd: dir, encoding: 'utf8' });
    assert.equal(stdout, 'shell-alive');
    assert.equal(readPiExitMarker(exitPath), 17);
    assert.throws(() => execFileSync('/bin/sh', ['-c', command], { cwd: dir, stdio: 'ignore' }),
      error => (error as { status?: number }).status === 17);
    const unavailable = herdrPiCommand({ cwd: dir, args: ['--probe'] }, pi, join(dir, 'extension.ts'), {}, join(dir, 'missing', 'exit'));
    assert.throws(() => execFileSync('/bin/sh', ['-c', unavailable], { cwd: dir, stdio: 'ignore' }),
      error => (error as { status?: number }).status === 17);
    assert.equal(readFileSync(args, 'utf8'), `--extension ${join(dir, 'extension.ts')} --probe\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bounded startup returns disabled, unavailable, timeout, correlated exit and ready distinctly', async () => {
  const token = 'bdbb6ae3-68d5-4335-8df7-79f4806e22ee';
  const receipt = { status: 'submitted' as const, herdrSocketPath: '/run/test.sock', tabId: 'target', paneId: 'pane' };
  const context = { scope: { kind: 'organization' as const, organization: 'one' } };
  const plan = { cwd: '/tmp/target', args: [], context: { version: 1 as const, cwd: '/tmp/target', context } };
  const installation = { sessionDirectory: '/unused', homeRoot: '/unused' } as Installation;
  const card = { version: 1 as const, instanceKey: token, nativeSessionId: 'new-native', cwd: plan.cwd,
    launchToken: token, context, herdrSocketPath: receipt.herdrSocketPath, herdrTabId: receipt.tabId,
    herdrPaneId: receipt.paneId, state: 'starting' as const, startedAt: 1, lastSeen: 1 };
  const list: SessionList = { sessions: [{ card, archived: false, ageMs: 0, status: 'starting' }], issues: [], truncated: false };
  let now = 0;
  const source = (inventory: SessionList, code?: number | 'unavailable') => ({ list: () => inventory, exit: () => code,
    now: () => now, wait: async () => { now = 8000; } });
  assert.deepEqual(await awaitNativePiStartup(receipt, plan, installation, token, { MYPI_SESSION_CARDS: '0' }),
    { ...receipt, observation: 'disabled' });
  assert.deepEqual(await awaitNativePiStartup(receipt, plan, installation, token, {}, undefined, source(list)),
    { ...receipt, status: 'ready', observation: 'confirmed' });
  assert.deepEqual(await awaitNativePiStartup(receipt, plan, installation, token, {}, undefined, source(list, 17)),
    { ...receipt, status: 'failed', observation: 'exit-nonzero', exitCode: 17 });
  now = 0;
  assert.deepEqual(await awaitNativePiStartup(receipt, plan, installation, token, {}, undefined,
    source({ ...list, sessions: [] })), { ...receipt, observation: 'timeout' });
  now = 0;
  assert.deepEqual(await awaitNativePiStartup(receipt, plan, installation, token, {}, undefined,
    source({ ...list, truncated: true })), { ...receipt, observation: 'unavailable' });
});
