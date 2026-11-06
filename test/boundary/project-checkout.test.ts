import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { inspectCheckout, prepareCheckout, prepareCheckouts } from '../../src/app/project-checkout.js';
import { planCheckout } from '../../src/modules/projects/public.js';
import { createJournal } from '../../src/modules/knowledge/public.js';
import { sameScope } from '../../src/shared/scope.js';

function git(...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
    { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('a project without a clone is cloned, initialized or adopted only when safe, verified and registered', async t => {
  const { dir, filename } = state(t);
  const bare = join(dir, 'remote.git'), seed = join(dir, 'seed'), root = join(realpathSync(dir), 'projects');
  git('init', '--bare', '--quiet', '--initial-branch=main', bare);
  git('init', '--quiet', '--initial-branch=main', seed);
  git('-C', seed, 'commit', '--quiet', '--allow-empty', '-m', 'seed');
  git('-C', seed, 'push', '--quiet', bare, 'main');
  const url = 'file://' + bare;
  const app = createApp(filename, false);
  const add = (identity: string, code: string, repository: string) => app.projects.add(identity, code, undefined, repository);
  const [remote, adopted, busy, foreign, empty, missing, taken, local, second, blocked] = (() => {
    try {
      return [add('one/remote', 'RE', url), add('one/adopted', 'AD', url), add('one/busy', 'BU', url), add('one/foreign', 'FO', url),
        add('one/empty', 'EM', url), add('one/missing', 'MI', join(dir, 'missing.git')), add('one/taken', 'TA', url),
        add('one/local', 'LO', 'local'), add('one/second', 'SE', 'local'), add('file/blocked', 'FB', 'local')];
    } finally { app.close(); }
  })();
  const checkout = (code: string) => {
    const read = createApp(filename, true);
    try { return read.projects.list().find(p => p.code === code)!.checkoutPath; } finally { read.close(); }
  };
  const journal = () => {
    const read = createApp(filename, true);
    try {
      return createJournal(read.journalStore, () => {}, sameScope, () => '').read('all').filter(e => e.event_type === 'clone_prepared')
        .map(e => [e.scope.type === 'global' ? null : e.scope.key, e.text]);
    } finally { read.close(); }
  };

  assert.deepEqual(await prepareCheckouts(filename, [remote, remote], root), [{ code: 'RE', checkoutPath: join(root, 'one', 'remote'), action: 'cloned' }]);
  assert.equal(git('-C', join(root, 'one', 'remote'), 'config', '--get', 'remote.origin.url'), url);
  assert.equal(checkout('RE'), join(root, 'one', 'remote'));
  assert.deepEqual(readdirSync(join(root, 'one')).filter(name => name.includes('.mypi-clone-')), []);

  git('clone', '--quiet', url, join(root, 'one', 'adopted'));
  assert.equal((await prepareCheckout(filename, adopted, root)).action, 'adopted');
  mkdirSync(join(root, 'one', 'busy'));
  writeFileSync(join(root, 'one', 'busy', 'keep.txt'), 'keep');
  await assert.rejects(prepareCheckout(filename, busy, root), /is a non-empty directory that is not the top level of a Git repository; nothing was changed/);
  assert.equal(readFileSync(join(root, 'one', 'busy', 'keep.txt'), 'utf8'), 'keep');
  git('clone', '--quiet', bare, join(root, 'one', 'foreign'));
  await assert.rejects(prepareCheckout(filename, foreign, root), /with origin .*, not /);
  mkdirSync(join(root, 'one', 'empty'));
  assert.equal((await prepareCheckout(filename, empty, root)).action, 'cloned');
  assert.deepEqual([checkout('AD'), checkout('BU'), checkout('FO'), checkout('EM')], [join(root, 'one', 'adopted'), null, null, join(root, 'one', 'empty')]);

  await assert.rejects(prepareCheckouts(filename, [local, missing], root),
    /^InputError: Cloning .* failed: .*does not exist.*nothing was registered; already prepared and registered: LO at .*; nothing was opened$/);
  assert.equal(existsSync(join(root, 'one', 'missing')), false);
  assert.equal(checkout('MI'), null);

  mkdirSync(join(root, 'one', 'taken'));
  const other = createApp(filename, false);
  try { other.projects.add('two/other', 'OT', join(root, 'one', 'taken')); } finally { other.close(); }
  await assert.rejects(prepareCheckout(filename, taken, root),
    /is ready \(cloned\) but registering it failed: Checkout path already registered.*--expected-unset --path /);
  assert.equal(git('-C', join(root, 'one', 'taken'), 'config', '--get', 'remote.origin.url'), url);
  assert.equal(checkout('TA'), null);

  writeFileSync(join(root, 'file'), 'not a directory');
  await assert.rejects(prepareCheckouts(filename, [second, blocked], root),
    /^InputError: ENOTDIR.*; already prepared and registered: SE at .*second; nothing was opened$/);
  assert.equal(checkout('FB'), null);

  const target = join(root, 'one', 'local');
  assert.equal(checkout('LO'), target);
  assert.equal(git('-C', target, 'log', '--format=%s'), 'Initial empty commit');
  assert.equal(git('-C', target, 'symbolic-ref', 'HEAD'), 'refs/heads/main');
  assert.equal(git('-C', target, 'remote'), '');
  assert.equal(planCheckout(local, target, inspectCheckout(target)), 'adopt');

  const more = createApp(filename, false);
  const [progress, leftover, live, cancelled] = (() => {
    try {
      return [more.projects.add('one/progress', 'PR', undefined, url), more.projects.add('one/leftover', 'LE', undefined, url),
        more.projects.add('one/live', 'LV', undefined, url), more.projects.add('one/cancelled', 'CA', undefined, url)];
    } finally { more.close(); }
  })();
  const lines: string[] = [];
  assert.equal((await prepareCheckout(filename, progress, root, { onProgress: l => lines.push(l) })).action, 'cloned');
  assert.equal(lines[0], 'cloning ' + url + ' into ' + join(root, 'one', 'progress'));

  const dead = spawnSync('/usr/bin/true').pid;
  const abandoned = join(root, 'one', '.leftover.mypi-clone-' + dead);
  git('init', '--quiet', abandoned);
  git('-C', abandoned, 'remote', 'add', 'origin', url);
  assert.equal((await prepareCheckout(filename, leftover, root)).action, 'cloned');
  assert.equal(existsSync(abandoned), false);
  assert.equal(git('-C', join(root, 'one', 'leftover'), 'config', '--get', 'remote.origin.url'), url);

  const sleeper = spawn('/usr/bin/sleep', ['30']);
  t.after(() => { sleeper.kill(); });
  const running = join(root, 'one', '.live.mypi-clone-' + sleeper.pid);
  mkdirSync(running);
  await assert.rejects(prepareCheckout(filename, live, root), /is being prepared by process \d+; wait for that \/open to finish or cancel it/);
  assert.equal(existsSync(running), true);
  assert.equal(existsSync(join(root, 'one', 'live')), false);
  assert.equal(checkout('LV'), null);

  await assert.rejects(prepareCheckout(filename, cancelled, root, { signal: AbortSignal.abort() }),
    /^CancelledError: open cancelled while preparing one\/cancelled; nothing was registered$/);
  assert.equal(existsSync(join(root, 'one', 'cancelled')), false);
  assert.deepEqual(readdirSync(join(root, 'one')).filter(name => name.startsWith('.cancelled.mypi-clone-')), []);
  assert.equal(checkout('CA'), null);
  assert.deepEqual(journal(), [
    ['RE', 'clone prepared: cloned ' + join(root, 'one', 'remote') + ' from ' + url],
    ['AD', 'clone prepared: adopted ' + join(root, 'one', 'adopted')],
    ['EM', 'clone prepared: cloned ' + join(root, 'one', 'empty') + ' from ' + url],
    ['LO', 'clone prepared: initialized ' + join(root, 'one', 'local')],
    ['SE', 'clone prepared: initialized ' + join(root, 'one', 'second')],
    ['PR', 'clone prepared: cloned ' + join(root, 'one', 'progress') + ' from ' + url],
    ['LE', 'clone prepared: cloned ' + join(root, 'one', 'leftover') + ' from ' + url],
  ]);
});
