import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftViewport, visibleSegment } from '../../src/cli/bootstrap-viewport.js';

test('horizontal inspection covers every character at narrow and normal widths', () => {
  const path = 'Home (new): /data/engine/home/repository/русский';
  for (const columns of [60, 80]) {
    const offsets = [0];
    while (offsets.at(-1)! < path.length) offsets.push(shiftViewport(offsets.at(-1)!, 1, columns));
    for (let index = 0; index < path.length; index++) {
      assert.ok(offsets.some(offset => index >= offset && index < offset + visibleSegment(path, offset, columns).length), `${columns}: missing character ${index}`);
    }
  }
});
