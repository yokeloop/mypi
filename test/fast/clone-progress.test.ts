import test from 'node:test';
import assert from 'node:assert/strict';
import { throttleProgress } from '../../src/app/clone-progress.js';

test('progress lines are throttled and repeated after a quiet spell', () => {
  const moments = [0, 100, 300, 300, 10_400];
  const emitted: [string, number][] = [];
  let at = 0;
  const report = throttleProgress(line => emitted.push([line, at]), () => at);
  ['a', 'b', 'c', 'c', 'c'].forEach((line, i) => { at = moments[i]!; report(line); });
  assert.deepEqual(emitted, [['a', 0], ['c', 300], ['c', 10_400]]);
});

test('a heartbeat repeat passes the throttle at once, so quiet gaps stay within the heartbeat cadence', () => {
  const emitted: [string, number][] = [];
  let at = 0;
  const report = throttleProgress(line => emitted.push([line, at]), () => at);
  report('a');
  at = 4_000; report('a');
  at = 9_000; report('a', true);
  at = 9_100; report('b');
  at = 19_000; report('a', true);
  at = 29_000; report('a', true);
  assert.deepEqual(emitted, [['a', 0], ['a', 9_000], ['a', 19_000], ['a', 29_000]]);
  for (let i = 1; i < emitted.length; i++) assert.ok(emitted[i]![1] - emitted[i - 1]![1] <= 10_000);
});
