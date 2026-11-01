import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { inspectCheckout, prepareCheckout, prepareCheckouts } from '../../src/app/project-checkout.js';
import { planCheckout } from '../../src/modules/projects/public.js';

function git(...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
    { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('a project without a clone is cloned, initialized or adopted only when safe, verified and registered', t => {
  const { dir, filename } = state(t);
  const bare = join(dir, 'remote.git'), seed = join(dir, 'seed'), root = join(realpathSync(dir), 'projects');
  git('init', '--bare', '--quiet', '--initial-branch=main', bare);
  git('init', '--quiet', '--initial-branch=main', seed);
  git('-C', seed, 'commit', '--quiet', '--allow-empty', '-m', 'seed');
  git('-C', seed, 'push', '--quiet', bare, 'main');
  const url = 'file://' + bare;
  const app = createApp(filename, false);
  const add = (identity: string, code: string, repository: string) => app.projects.add(identity, code, undefined, repository);
  const [remote, adopted, busy, foreign, empty, missing, taken, local] = (() => {
    try {
      return [add('one/remote', 'RE', url), add('one/adopted', 'AD', url), add('one/busy', 'BU', url), add('one/foreign', 'FO', url),
        add('one/empty', 'EM', url), add('one/missing', 'MI', join(dir, 'missing.git')), add('one/taken', 'TA', url),
        add('one/local', 'LO', 'local')];
    } finally { app.close(); }
  })();
  const checkout = (code: string) => {
    const read = createApp(filename, true);
    try { return read.projects.list().find(p => p.code === code)!.checkoutPath; } finally { read.close(); }
  };

  assert.deepEqual(prepareCheckouts(filename, [remote, remote], root), [{ code: 'RE', checkoutPath: join(root, 'one', 'remote'), action: 'cloned' }]);
  assert.equal(git('-C', join(root, 'one', 'remote'), 'config', '--get', 'remote.origin.url'), url);
  assert.equal(checkout('RE'), join(root, 'one', 'remote'));

  git('clone', '--quiet', url, join(root, 'one', 'adopted'));
  assert.equal(prepareCheckout(filename, adopted, root).action, 'adopted');
  mkdirSync(join(root, 'one', 'busy'));
  writeFileSync(join(root, 'one', 'busy', 'keep.txt'), 'keep');
  assert.throws(() => prepareCheckout(filename, busy, root), /is a non-empty directory that is not the top level of a Git repository; nothing was changed/);
  assert.equal(readFileSync(join(root, 'one', 'busy', 'keep.txt'), 'utf8'), 'keep');
  git('clone', '--quiet', bare, join(root, 'one', 'foreign'));
  assert.throws(() => prepareCheckout(filename, foreign, root), /with origin .*, not /);
  mkdirSync(join(root, 'one', 'empty'));
  assert.equal(prepareCheckout(filename, empty, root).action, 'cloned');
  assert.deepEqual([checkout('AD'), checkout('BU'), checkout('FO'), checkout('EM')], [join(root, 'one', 'adopted'), null, null, join(root, 'one', 'empty')]);

  assert.throws(() => prepareCheckouts(filename, [local, missing], root),
    /^InputError: Cloning .* failed: .*does not exist.*nothing was registered; already prepared and registered: LO at .*; nothing was opened$/);
  assert.equal(existsSync(join(root, 'one', 'missing')), false);
  assert.equal(checkout('MI'), null);

  mkdirSync(join(root, 'one', 'taken'));
  const other = createApp(filename, false);
  try { other.projects.add('two/other', 'OT', join(root, 'one', 'taken')); } finally { other.close(); }
  assert.throws(() => prepareCheckout(filename, taken, root),
    /is ready \(cloned\) but registering it failed: Checkout path already registered.*--expected-unset --path /);
  assert.equal(git('-C', join(root, 'one', 'taken'), 'config', '--get', 'remote.origin.url'), url);
  assert.equal(checkout('TA'), null);

  const target = join(root, 'one', 'local');
  assert.equal(checkout('LO'), target);
  assert.equal(git('-C', target, 'log', '--format=%s'), 'Initial empty commit');
  assert.equal(git('-C', target, 'symbolic-ref', 'HEAD'), 'refs/heads/main');
  assert.equal(git('-C', target, 'remote'), '');
  assert.equal(planCheckout(local, target, inspectCheckout(target)), 'adopt');
});
