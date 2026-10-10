import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { resolveInstallation, installationEnvironment, validateInstallation } from '../../src/app/installation.js';

test('explicit binding selects one engine and external data without touching DB or fallback', t => {
  const { dir } = state(t), a = join(dir, 'engine-a'), b = join(dir, 'engine-b'), home = join(dir, 'home');
  mkdirSync(a); mkdirSync(b); mkdirSync(home);
  const dbA = join(dir, 'a.sqlite3'), dbB = join(dir, 'b.sqlite3');
  const binding = (engineRoot: string, database: string) => ({ version: 1, engineRoot, homeRoot: home, database, stateRoot: join(dir, database === dbA ? 'a-state' : 'b-state') });
  const fileA = join(a, '.mypi-local.json'), fileB = join(b, '.mypi-local.json');
  writeFileSync(fileA, JSON.stringify(binding(a, dbA)));
  writeFileSync(fileB, JSON.stringify(binding(b, dbB)));
  const first = resolveInstallation(a, { XDG_STATE_HOME: join(dir, 'personal') });
  const second = resolveInstallation(b, {});
  assert.equal(first.database, dbA); assert.equal(second.database, dbB);
  assert.equal(first.homeRoot, second.homeRoot);
  assert.notEqual(first.sessionDirectory, second.sessionDirectory);
  assert.deepEqual(installationEnvironment(first, { MYPI_INSTALLATION_FILE: fileB, MYPI_SESSION_DIR: second.sessionDirectory }),
    { MYPI_INSTALLATION_FILE: fileA, MYPI_SESSION_DIR: first.sessionDirectory, MYPI_MAILBOX_DIR: first.mailboxDirectory });
  assert.throws(() => resolveInstallation(a, { MYPI_INSTALLATION_FILE: fileB }), /different engine/);
  assert.throws(() => resolveInstallation(a, { MYPI_MAILBOX_DIR: second.mailboxDirectory }), /conflicts/);
  assert.throws(() => resolveInstallation(b, { MYPI_INSTALLATION_FILE: join(dir, 'missing') }), /not configured/);
  assert.throws(() => validateInstallation({ ...binding(a, dbA), version: 2 }), /Invalid/);
  assert.throws(() => resolveInstallation(a, { MYPI_INSTALLATION_FILE: 'relative' }), /absolute/);
  symlinkSync(a, join(dir, 'alias'));
  writeFileSync(fileA, JSON.stringify(binding(a, join(dir, 'alias/db.sqlite3'))));
  assert.throws(() => resolveInstallation(a, {}), /outside/);
  assert.equal(readFileSync(fileB, 'utf8'), JSON.stringify(binding(b, dbB)));
  mkdirSync(join(dir, 'cache'));
  symlinkSync(a, join(dir, 'cache/sessions'));
  writeFileSync(fileA, JSON.stringify({ ...binding(a, dbA), stateRoot: join(dir, 'cache') }));
  assert.throws(() => resolveInstallation(a, {}), /outside/);
});
