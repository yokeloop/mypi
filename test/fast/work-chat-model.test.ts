import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseModelDefaults, parseModelInvocation, resolveModelSelection, sameModelSelection } from '../../src/modules/work-chats/public.js';
import { selectWorkChatModel } from '../../src/app/work-chat-model.js';

const registered = {
  organization: (slug: string) => slug === 'acme',
  project: (identity: string) => identity === 'acme/tool',
};
const a = { provider: 'one', model: 'model/a' };
const b = { provider: 'two', model: 'model/b' };
const c = { provider: 'three', model: 'model/c' };
const d = { provider: 'four', model: 'model/d' };
const config = parseModelDefaults({ default: a, organizations: { acme: b }, projects: { 'acme/tool': c } }, registered);

test('atomic model precedence, omission inheritance and native saved choice', () => {
  const choices = [
    [{}, c, 'project'],
    [{ invocation: d }, d, 'invocation'],
    [{ saved: { status: 'selected', selection: b } }, b, 'saved session'],
    [{ saved: { status: 'selected', selection: b }, invocation: d }, d, 'invocation'],
  ] as const;
  for (const [params, pair, source] of choices) {
    assert.deepEqual(resolveModelSelection({ identity: 'acme/tool', readDefaults: () => config, ...params }), { ...pair, source });
  }
  assert.deepEqual(resolveModelSelection({ identity: 'acme/tool', readDefaults: () => ({ ...config, projects: {} }) }),
    { ...b, source: 'organization' });
  assert.deepEqual(resolveModelSelection({ identity: 'acme/tool', readDefaults: () => ({ default: a }) }),
    { ...a, source: 'default' });
  assert.deepEqual(resolveModelSelection({ identity: 'acme/tool', readDefaults: () => ({ organizations: { acme: b } }) }),
    { ...b, source: 'organization' });
  assert.equal(sameModelSelection({ ...a, source: 'default' }, { ...a, source: 'project' }), false);
  assert.equal(sameModelSelection({ ...a, source: 'default' }, { ...a, source: 'default' }), true);
  assert.deepEqual(resolveModelSelection({ identity: 'acme/tool', readDefaults: () => ({}) }), { source: 'unselected' });
});

test('registered constructor inherits the default unless an own override exists', () => {
  const constructorRegistered = { organization: (slug: string) => slug === 'constructor', project: (identity: string) => identity === 'constructor/tool' };
  const inherited = parseModelDefaults({ default: a, organizations: {}, projects: {} }, constructorRegistered);
  assert.deepEqual(resolveModelSelection({ identity: 'constructor/tool', readDefaults: () => inherited }), { ...a, source: 'default' });
  const own = parseModelDefaults(JSON.parse(JSON.stringify({ default: a, organizations: { constructor: b } })), constructorRegistered);
  assert.deepEqual(resolveModelSelection({ identity: 'constructor/tool', readDefaults: () => own }), { ...b, source: 'organization' });
});

test('explicit or native saved selection bypasses broken defaults, but corrupt history never inherits', () => {
  const fail = () => { throw new Error('broken config read'); };
  assert.deepEqual(resolveModelSelection({ identity: 'acme/tool', saved: { status: 'none' }, readDefaults: fail }), { source: 'unselected' });
  assert.equal(resolveModelSelection({ identity: 'acme/tool', invocation: d, readDefaults: fail }).source, 'invocation');
  assert.equal(resolveModelSelection({ identity: 'acme/tool', saved: { status: 'selected', selection: b }, readDefaults: fail }).source, 'saved session');
  assert.throws(() => resolveModelSelection({ identity: 'acme/tool', invocation: d,
    saved: { status: 'unavailable', reason: 'missing history' }, readDefaults: fail }), /missing history/);
});

test('model selectors preserve slash-containing IDs and refuse missing/conflicting pieces', () => {
  assert.deepEqual(parseModelInvocation({ model: 'one/model/a' }), a);
  assert.deepEqual(parseModelInvocation({ provider: 'one', model: 'model/a' }), a);
  assert.equal(parseModelInvocation({}), undefined);
  for (const input of [{ provider: 'one' }, { model: 'bare' }, { provider: '', model: 'x' },
    { provider: 'one/two', model: 'x' }, { provider: 'one', model: '' }, { model: '/model' }]) {
    assert.throws(() => parseModelInvocation(input));
  }
});

test('JSON schema checks complete pairs, unknown fields and registered identities', () => {
  assert.deepEqual(parseModelDefaults({}, registered), {});
  for (const value of [null, [], { default: null }, { default: { provider: 'one' } },
    { default: { provider: 'one', model: '' } }, { default: { ...a, extra: 1 } },
    { organizations: { stranger: a } }, { projects: { 'acme/stranger': a } },
    { projects: { 'acme/tool/other': a } }, { organizations: null }, { unrecognized: a }]) {
    assert.throws(() => parseModelDefaults(value, registered));
  }
});

test('app selection reads only needed user file and validates registry references before choice', t => {
  const home = mkdtempSync(join(tmpdir(), 'work-chat-model-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'pi'));
  const filename = join(home, 'pi', 'work-chats.json');
  const projects = { resolveScope(identity: string) {
    if (identity === 'acme') return { type: 'org' as const, id: 1, slug: 'acme' };
    if (identity === 'acme/tool') return { type: 'project' as const, project: {
      id: 1, org: 'acme', slug: 'tool', code: 'TOOL', checkoutPath: null,
    } };
    throw new Error('unknown');
  } };
  assert.deepEqual(selectWorkChatModel({ identity: 'acme/tool', userHome: home, projects }), { source: 'unselected' });
  writeFileSync(filename, '{invalid');
  assert.deepEqual(selectWorkChatModel({ identity: 'acme/tool', userHome: home, projects, invocation: d }),
    { ...d, source: 'invocation' });
  assert.throws(() => selectWorkChatModel({ identity: 'acme/tool', userHome: home, projects }), /Invalid JSON/);
  writeFileSync(filename, JSON.stringify({ default: a, projects: { 'acme/foreign': b } }));
  assert.throws(() => selectWorkChatModel({ identity: 'acme/tool', userHome: home, projects }), /unknown registered project/);
  writeFileSync(filename, JSON.stringify({ default: a, projects: { 'acme/tool': c } }));
  assert.deepEqual(selectWorkChatModel({ identity: 'acme/tool', userHome: home, projects }), { ...c, source: 'project' });
});
