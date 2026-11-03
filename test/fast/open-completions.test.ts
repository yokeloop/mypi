import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPLETION_LIMIT, completionSource, openCompletions, scopeCode } from '../../.pi/extensions/mypi-lib/open-completions.js';
import type { OpenCatalog } from '../../.pi/extensions/mypi-lib/open-completions.js';

const title = 'Подсказки проектов и задач для /open в Pi';
const catalog: OpenCatalog = {
  projects: [{ id: 2, org: 'acme', slug: 'shop', code: 'SH' }, { id: 1, org: 'yokeloop', slug: 'mypi', code: 'MP' }],
  tasks: [
    { projectId: 1, number: 75, title: 'Clone progress', status: 'merged', isTerminal: false, key: 'MP-75' },
    { projectId: 2, number: 3, title: 'Cart', status: 'open', isTerminal: false, key: 'SH-3' },
    { projectId: 1, number: 12, title: 'Old', status: 'done', isTerminal: true, key: 'MP-12' },
    { projectId: null, number: 1, title: 'Request', status: 'open', isTerminal: false, key: 'REQ-1' },
    { projectId: 1, number: 74, title, status: 'planning', isTerminal: false, key: 'MP-74' },
  ],
};
const labels = (items: { label: string }[] | null) => items?.map(item => item.label) ?? null;

test('open completions list the project and its open tasks in a project chat', () => {
  const items = openCompletions('', catalog, 'MP');
  assert.deepEqual(labels(items), ['MP', 'MP-74', 'MP-75']);
  assert.deepEqual(items!.map(item => item.value), ['MP ', 'MP-74 ', 'MP-75 ']);
  assert.equal(items![0]!.description, 'yokeloop/mypi');
  assert.equal(items![1]!.description, `planning · ${title}`);
  assert.equal(scopeCode('MP-74'), 'MP');
  assert.deepEqual(openCompletions('', catalog, scopeCode('MP-74')), items);
});

test('open completions list all projects and open tasks in the main chat', () => {
  const all = ['MP', 'SH', 'MP-74', 'MP-75', 'SH-3'];
  assert.equal(scopeCode('global'), undefined);
  assert.equal(scopeCode(undefined), undefined);
  for (const scope of [undefined, scopeCode('global'), 'ZZ']) assert.deepEqual(labels(openCompletions('', catalog, scope)), all);
});

test('open completions filter by the typed token', () => {
  assert.deepEqual(labels(openCompletions('mp-7', catalog, undefined)), ['MP-74', 'MP-75']);
  assert.deepEqual(labels(openCompletions('cart', catalog, undefined)), ['SH-3']);
  assert.deepEqual(labels(openCompletions('acme', catalog, undefined)), ['SH']);
  assert.equal(openCompletions('xyz', catalog, undefined), null);
});

test('open completions keep earlier keys and skip them', () => {
  const after = openCompletions('MP ', catalog, undefined)!;
  assert.equal(after[0]!.value, 'MP SH ');
  assert.ok(!labels(after)!.includes('MP'));
  const flagged = openCompletions('MP-74 --agent pi M', catalog, undefined)!;
  assert.deepEqual(flagged.slice(0, 2).map(item => item.value), ['MP-74 --agent pi MP ', 'MP-74 --agent pi MP-75 ']);
  assert.ok(!labels(flagged)!.includes('MP-74'));
});

test('open completions stay silent for flags and after --message', () => {
  for (const prefix of ['MP --', 'MP --agent ', 'MP --permission-mode a', 'MP --message ', 'MP --message сделай M'])
    assert.equal(openCompletions(prefix, catalog, undefined), null, prefix);
});

test('open completions cap the list', () => {
  const tasks = Array.from({ length: 60 }, (_, i) => ({ projectId: 1, number: i + 1, title: 't', status: 'open', isTerminal: false, key: `MP-${i + 1}` }));
  assert.equal(openCompletions('', { projects: [catalog.projects[1]!], tasks }, 'MP')!.length, COMPLETION_LIMIT);
  assert.equal(COMPLETION_LIMIT, 50);
});

test('completion source caches for the TTL and shares the load in flight', async () => {
  let clock = 1000, loads = 0;
  let resolve: (value: OpenCatalog) => void = () => {};
  const source = completionSource(() => { loads++; return new Promise<OpenCatalog>(done => { resolve = done; }); }, () => clock);
  const first = source(), second = source();
  assert.equal(loads, 1);
  resolve(catalog);
  assert.equal(await first, catalog);
  assert.equal(await second, catalog);
  clock += 14_999;
  assert.equal(await source(), catalog);
  assert.equal(loads, 1);
  clock += 1;
  const third = source();
  assert.equal(loads, 2);
  resolve(catalog);
  assert.equal(await third, catalog);
});

test('completion source does not cache a failure', async () => {
  let loads = 0;
  const source = completionSource(async () => {
    loads++;
    if (loads === 1) return undefined;
    if (loads === 2) throw new Error('boom');
    return catalog;
  }, () => 0);
  assert.equal(await source(), undefined);
  assert.equal(await source(), undefined);
  assert.equal(await source(), catalog);
  assert.equal(loads, 3);
});
