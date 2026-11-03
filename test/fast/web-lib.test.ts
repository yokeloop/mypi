import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiFailure, INITIAL_CHANGES, apiPath, asPage, display, extraFields, filterProjects, filtersOf, onChange, onDisconnect,
  unwrap, withFilter,
} from '../../web/src/shared/lib/index.js';

const failure = (code: string, status?: number) => (error: unknown) =>
  error instanceof ApiFailure && error.code === code && (status === undefined || error.status === status);

test('unwrap returns data and turns error envelopes, non-2xx bodies and bodies without data into ApiFailure', () => {
  assert.deepEqual(unwrap(200, { apiVersion: 1, data: { a: 1 } }), { a: 1 });
  assert.throws(() => unwrap(403, { apiVersion: 1, error: { code: 'forbidden', message: 'm' } }),
    (error: unknown) => error instanceof ApiFailure && error.status === 403 && error.code === 'forbidden' && error.message === 'm');
  assert.throws(() => unwrap(502, null), failure('http_error', 502));
  assert.throws(() => unwrap(200, {}), failure('bad_response', 200));
});

test('asPage keeps object items and a string next and tolerates odd fields', () => {
  assert.deepEqual(asPage({ items: [{ key: 'MP-1' }, 3, null, []], next: 'abc', extra: 1 }), { items: [{ key: 'MP-1' }], next: 'abc' });
  assert.equal(asPage({ items: [], next: 5 }).next, null);
  assert.throws(() => asPage({}), failure('bad_response'));
});

test('screen filters keep known non-empty keys and build API paths with the cursor and UTC journal bounds', () => {
  const filters = filtersOf('tasks', new URLSearchParams('status=new&foo=1&q=%20&project=MP'));
  assert.deepEqual(filters, { project: 'MP', status: 'new' });
  assert.deepEqual(Object.keys(filters), ['project', 'status']);
  assert.equal(apiPath('tasks', { project: 'MP', q: 'a b' }, 'Y3Vy'), '/v1/tasks?project=MP&q=a+b&cursor=Y3Vy');
  assert.equal(apiPath('tasks', {}), '/v1/tasks');
  assert.equal(apiPath('events', { delivered: 'maybe', kind: 'message' }), '/v1/events?kind=message');
  assert.equal(apiPath('journal', { from: '2026-11-01', to: '2026-11-03', scope: 'MP' }),
    '/v1/journal?scope=MP&from=2026-11-01T00%3A00%3A00Z&to=2026-11-03T23%3A59%3A59Z');
  assert.equal(apiPath('journal', { from: '2026-13' }), '/v1/journal');
  assert.equal(apiPath('projects', { org: 'yokeloop', q: 'x' }), '/v1/projects?org=yokeloop');
});

test('withFilter copies and sets or removes one key and filterProjects matches code and identity case-insensitively', () => {
  const params = new URLSearchParams('q=a&status=new');
  assert.equal(withFilter(params, 'status', 'done').get('status'), 'done');
  assert.equal(withFilter(params, 'q', '  ').has('q'), false);
  assert.equal(withFilter(params, 'q', null).has('q'), false);
  assert.equal(params.toString(), 'q=a&status=new');
  const projects = [{ code: 'MP', identity: 'yokeloop/mypi' }, { code: 'OT', identity: 'a/other' }];
  assert.deepEqual(filterProjects(projects, 'MYPI'), [projects[0]]);
  assert.deepEqual(filterProjects(projects, 'ot'), [projects[1]]);
  assert.deepEqual(filterProjects(projects, undefined), projects);
});

test('field helpers display any value and list unknown fields in record order', () => {
  assert.equal(display(null), '—');
  assert.equal(display({ a: [1] }), '{"a":[1]}');
  assert.equal(display(false), 'false');
  assert.deepEqual(extraFields({ key: 'MP-1', zeta: 1, alpha: null }, ['key']), [['zeta', '1'], ['alpha', '—']]);
});

test('change tracking refetches on a new changeId or after a disconnect and ignores the first and malformed events', () => {
  let step = onChange(INITIAL_CHANGES, '{"changeId":3}');
  assert.equal(step.refetch, false);
  step = onChange(step.state, '{"changeId":3}');
  assert.equal(step.refetch, false);
  step = onChange(step.state, '{"changeId":4}');
  assert.equal(step.refetch, true);
  const malformed = onChange(step.state, 'nope');
  assert.equal(malformed.refetch, false);
  assert.equal(malformed.state.last, 4);
  step = onChange(onDisconnect(malformed.state), '{"changeId":4}');
  assert.equal(step.refetch, true);
  step = onChange(step.state, '{"changeId":4}');
  assert.equal(step.refetch, false);
});
