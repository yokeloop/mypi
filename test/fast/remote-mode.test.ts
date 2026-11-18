import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { serverConfigPath } from '../../src/infrastructure/filesystem/paths.js';
import { readServerConfig } from '../../src/infrastructure/filesystem/server-config.js';
import { InputError } from '../../src/shared/errors.js';

function temporary(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-remote-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the server file must be a private regular file with exactly url, token and an optional device', t => {
  const dir = temporary(t), file = join(dir, 'server.json');
  assert.equal(readServerConfig(file), undefined);
  const write = (value: string, mode = 0o600) => { rmSync(file, { force: true }); writeFileSync(file, value, { mode }); chmodSync(file, mode); };
  write('{"url":"http://127.0.0.1:8737/","token":"mypi_x"}');
  assert.deepEqual(readServerConfig(file), { url: 'http://127.0.0.1:8737', token: 'mypi_x' });
  write('{"url":"http://127.0.0.1:8737/","token":"mypi_x","device":"rpi-laptop"}');
  assert.deepEqual(readServerConfig(file), { url: 'http://127.0.0.1:8737', token: 'mypi_x', device: 'rpi-laptop' });
  write('{"url":"http://127.0.0.1:8737/","token":"mypi_x"}', 0o644);
  assert.throws(() => readServerConfig(file), (error: unknown) => error instanceof InputError && /must be a private regular file \(0600\)/.test(error.message));
  write('{"url":"http://127.0.0.1:8737/","token":"mypi_x"}');
  const link = join(dir, 'link.json');
  symlinkSync(file, link);
  assert.throws(() => readServerConfig(link), (error: unknown) => error instanceof InputError && /must be a private regular file \(0600\)/.test(error.message));
  for (const value of ['{"url":"http://127.0.0.1:8737/","token":"mypi_x","extra":1}', '{"url":"ftp://host","token":"mypi_x"}',
    '{"url":"http://h/x","token":"mypi_x"}', '{"url":"http://h/","token":""}', '{"url":"http://h/","token":"mypi_x","device":""}']) {
    write(value);
    assert.throws(() => readServerConfig(file), (error: unknown) => error instanceof InputError && /Invalid server file/.test(error.message), value);
  }
  assert.equal(serverConfigPath({ HOME: '/home/u' }), '/home/u/.config/mypi/server.json');
  assert.equal(serverConfigPath({ XDG_CONFIG_HOME: '/c', HOME: '/h' }), '/c/mypi/server.json');
  assert.equal(serverConfigPath({ XDG_CONFIG_HOME: 'rel' }), undefined);
  assert.equal(serverConfigPath({}), undefined);
});
