import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePiExecutable } from '../../src/infrastructure/process/pi-executable.js';

test('Pi selection never runs or skips a first PATH updater; explicit installed selection is available', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypi-pi-selection-'));
  try {
    const first = join(root, 'wrapper'), installed = join(root, 'installed');
    mkdirSync(first); mkdirSync(installed);
    writeFileSync(join(first, 'pi'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(installed, 'pi'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), { mode: 0o755 });
    const env = { PATH: `${first}:${installed}` };
    assert.throws(() => resolvePiExecutable(env, root), /MYPI_PI_EXECUTABLE/);
    assert.equal(resolvePiExecutable({ ...env, MYPI_PI_EXECUTABLE: join(installed, 'pi') }, root), join(installed, 'pi'));
    assert.equal(resolvePiExecutable({ PATH: installed }, root), join(installed, 'pi'));
    assert.throws(() => resolvePiExecutable({ PATH: first, MYPI_PI_EXECUTABLE: join(root, 'missing') }, root), /MYPI_PI_EXECUTABLE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
