import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planUserLayer, applyUserLayer } from '../../src/app/setup-user-layer.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';
import { initializeState } from '../../src/app/create-app.js';
import { backupState, restoreState } from '../../src/app/backup.js';
import type { TestContext } from 'node:test';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-user-layer-')), root = join(dir, 'engine');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(root, 'integrations/pi'), { recursive: true });
  writeFileSync(join(root, 'integrations/pi/package.json'), '{"name":"mypi-pi"}\n');
  return { dir, root, home: join(root, 'home') };
}

// Real Git is needed to prove independence of home and backup of the instruction link.
test('user setup is opt-in, repeatable, preserves settings, and instruction links survive backup/restore', async t => {
  const { dir, root, home } = fixture(t);
  const plan = planUserLayer(root);
  assert.equal(existsSync(home), false); // Preview/cancel cannot create data.
  assert.equal(existsSync(join(root, '.pi')), false);
  applyUserLayer(plan);
  assert.equal(readlinkSync(join(root, '.pi')), 'home/pi');
  assert.equal(readlinkSync(join(home, 'pi/APPEND_SYSTEM.md')), '../USER-INSTRUCTIONS.md');
  assert.match(readFileSync(join(home, '.git/HEAD'), 'utf8'), /refs\/heads\/main/);
  assert.deepEqual(applyUserLayer(planUserLayer(root)), []);
  const settings = join(home, 'pi/settings.json');
  const userConfig = '{"theme":"personal","packages":[{"source":"' + join(root, 'integrations/pi') + '","skills":[]}] }\n';
  writeFileSync(settings, userConfig);
  assert.deepEqual(applyUserLayer(planUserLayer(root)), []);
  assert.equal(readFileSync(settings, 'utf8'), userConfig); // Explicit package filters are not undone.
  writeFileSync(settings, '{"theme":"personal","packages":["./other-package"]}\n');
  const before = readFileSync(settings, 'utf8');
  applyUserLayer(planUserLayer(root));
  assert.equal(readFileSync(settings + '.before-bootstrap', 'utf8'), before);
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')), { theme: 'personal', packages: ['./other-package', join(root, 'integrations/pi')] });
  const commit = spawnSync('git', ['-C', home, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'add', '.'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(commit.status, 0, commit.stderr);
  const result = spawnSync('git', ['-C', home, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'User configuration'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
  const db = join(dir, 'state.sqlite3'); initializeState(db);
  await backupState(db, join(dir, 'backup'), home);
  restoreState(join(dir, 'backup'), join(dir, 'restored.sqlite3'), join(dir, 'restored'));
  assert.equal(readlinkSync(join(dir, 'restored/pi/APPEND_SYSTEM.md')), '../USER-INSTRUCTIONS.md');
  assert.equal(readFileSync(join(dir, 'restored/pi/settings.json'), 'utf8'), readFileSync(settings, 'utf8'));
  rmSync(join(home, 'pi/APPEND_SYSTEM.md'));
  symlinkSync('../../outside', join(home, 'pi/APPEND_SYSTEM.md'));
  assert.throws(() => contextGit(home).cleanAll(), /Symlink/); // Exception cannot admit arbitrary links.
});

test('setup refuses conflicts and stale previews without overwrites; legacy instruction-only .pi can migrate', t => {
  const { root, home } = fixture(t);
  mkdirSync(join(root, '.pi'));
  writeFileSync(join(root, '.pi/settings.json'), '{"personal":true}\n');
  assert.throws(() => planUserLayer(root), /Conflicting user path/);
  assert.equal(existsSync(home), false);
  assert.equal(readFileSync(join(root, '.pi/settings.json'), 'utf8'), '{"personal":true}\n');
  rmSync(join(root, '.pi/settings.json'));
  symlinkSync('../home/USER-INSTRUCTIONS.md', join(root, '.pi/APPEND_SYSTEM.md'));
  const plan = planUserLayer(root);
  mkdirSync(home); writeFileSync(join(home, 'USER-INSTRUCTIONS.md'), 'Personal text\r\n');
  assert.throws(() => applyUserLayer(plan), /changed after preview/);
  assert.deepEqual(readdirSync(home), ['USER-INSTRUCTIONS.md']);
  mkdirSync(join(home, '.git'));
  assert.throws(() => planUserLayer(root), /Git repository|git repository/);
  assert.equal(existsSync(join(home, 'pi')), false);
  rmSync(join(home, '.git'), { recursive: true });
  applyUserLayer(planUserLayer(root));
  assert.equal(readFileSync(join(root, '.pi/APPEND_SYSTEM.md'), 'utf8'), 'Personal text\r\n');
  const cli = spawnSync(process.execPath, ['/work/dist/src/cli/bootstrap.js'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /interactive terminal/);
  assert.equal(existsSync('/work/home'), false);
});
