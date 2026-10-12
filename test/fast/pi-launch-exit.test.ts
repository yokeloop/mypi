import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePiExitMarker, readPiExitMarker } from '../../src/infrastructure/filesystem/pi-launch-exit.js';

test('private per-launch exit acknowledgement is exclusive, bounded and nofollow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-exit-'));
  const token = 'bdbb6ae3-68d5-4335-8df7-79f4806e22ee';
  try {
    const path = preparePiExitMarker(join(dir, 'sessions'), token);
    assert.equal(readPiExitMarker(path), undefined);
    assert.throws(() => preparePiExitMarker(join(dir, 'sessions'), token), /EEXIST/);
    writeFileSync(path, 'exit:42\n', { flag: 'wx', mode: 0o600 });
    assert.equal(readPiExitMarker(path), 42);
    writeFileSync(path, 'exit:0\n');
    assert.equal(readPiExitMarker(path), 0);
    writeFileSync(path, 'exit:999\n');
    assert.equal(readPiExitMarker(path), 'unavailable');
    writeFileSync(path, Buffer.from([0xe5, ...Buffer.from('xit:1\n')]));
    assert.equal(readPiExitMarker(path), 'unavailable');
    writeFileSync(path, 'exit:1\n'.repeat(20));
    assert.equal(readPiExitMarker(path), 'unavailable');
    rmSync(path);
    const target = join(dir, 'foreign'); writeFileSync(target, 'exit:1\n');
    symlinkSync(target, path);
    assert.equal(readPiExitMarker(path), 'unavailable');
    assert.equal(readFileSync(target, 'utf8'), 'exit:1\n');
    const alias = join(dir, 'alias');
    symlinkSync(join(dir, 'sessions', 'launches'), alias);
    assert.equal(readPiExitMarker(join(alias, token, 'exit')), 'unavailable');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
