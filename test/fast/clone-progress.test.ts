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
