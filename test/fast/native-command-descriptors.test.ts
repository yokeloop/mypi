import test from 'node:test';
import assert from 'node:assert/strict';
import { createMypiRegistryCache, mypiCompletions, mypiHelp, parseMypiCommand } from '../../src/app/native-command-descriptors.js';

test('mypi descriptor drives menu/help, parsing and read-only editor suggestions', () => {
  assert.deepEqual(parseMypiCommand(''), { action: 'menu' });
  assert.deepEqual(parseMypiCommand('help'), { action: 'help' });
  assert.deepEqual(parseMypiCommand('open one/app'), { action: 'open', target: 'one/app' });
  assert.deepEqual(parseMypiCommand('open one/app --worktree /existing'),
    { action: 'open', target: 'one/app', worktree: '/existing' });
  assert.deepEqual(parseMypiCommand('open one/app --worktree'), { action: 'open', target: 'one/app', pickWorktree: true });
  assert.deepEqual(parseMypiCommand('open one/app --worktree "/existing/tree with spaces"'),
    { action: 'open', target: 'one/app', worktree: '/existing/tree with spaces' });
  assert.deepEqual(parseMypiCommand('open one/app --worktree "/existing/a  b\ttree"').worktree,
    '/existing/a  b\ttree', 'quoted tabs/double spaces are not normalized (later request validation rejects controls)');
  assert.equal(parseMypiCommand('open one/app --worktree /existing/a\\ \\ b').worktree, '/existing/a  b');
  assert.deepEqual(mypiCompletions('o').map(item => item.value), ['open']);
  assert.deepEqual(mypiCompletions('open one/', ['one', 'one/app', 'one/other', 'two/app']).map(item => item.value),
    ['open one/app', 'open one/other']);
  assert.match(mypiHelp(), /registered base checkout/);
  for (const bad of ['other', 'open --worktree /x', 'open one --worktree /x', 'open one/app --worktree relative',
    'open one/app --worktree "/unterminated', 'open one/app --worktree "/one" trailing', 'help extra'])
    assert.throws(() => parseMypiCommand(bad), /Invalid \/mypi arguments/);
});

test('completion snapshot warms once, reports failures and refreshes only on explicit requests', async () => {
  let calls = 0;
  const registry = createMypiRegistryCache(async cwd => {
    calls++;
    if (calls === 1) throw Error('Database unavailable');
    return cwd === '/a' ? ['one', 'one/app'] : ['two'];
  }, 'selected-installation');
  registry.warm('/a');
  await registry.refresh('/a');
  assert.equal(registry.failure('/a'), 'Database unavailable');
  registry.warm('/a');
  assert.equal(calls, 1, 'failed completion never loops on subsequent keystrokes');
  await registry.refresh('/a');
  assert.deepEqual(registry.targets('/a'), ['one', 'one/app']);
  registry.warm('/a');
  assert.equal(calls, 2, 'successful completion does not spawn per keystroke');
  assert.deepEqual(registry.targets('/b'), [], 'cwd changes invalidate the visible snapshot');
  await registry.refresh('/b');
  assert.deepEqual(registry.targets('/b'), ['two']);
  assert.equal(calls, 3);
});

test('registry refresh uses request ownership when cwd switches A → B → A', async () => {
  const resolvers: Array<(targets: string[]) => void> = [];
  const cache = createMypiRegistryCache(() => new Promise<string[]>(resolve => { resolvers.push(resolve); }), 'installation');
  const first = cache.refresh('/a');
  await Promise.resolve();
  const middle = cache.refresh('/b');
  await Promise.resolve();
  const latest = cache.refresh('/a');
  await Promise.resolve();
  assert.equal(resolvers.length, 3);
  resolvers[0]!(['old']);
  await first;
  assert.deepEqual(cache.targets('/a'), [], 'stale A cannot overwrite newer A');
  const same = cache.refresh('/a');
  assert.equal(resolvers.length, 3, 'same-current-key requests coalesce');
  resolvers[1]!(['middle']);
  await middle;
  assert.deepEqual(cache.targets('/b'), []);
  resolvers[2]!(['current']);
  await Promise.all([latest, same]);
  assert.deepEqual(cache.targets('/a'), ['current']);
  assert.equal(cache.failure('/b'), undefined);
});
