import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('.pi/settings.json starts pi-subagents children without ambient extensions and scans the engine and home role folders', () => {
  assert.deepEqual(JSON.parse(read('.pi/settings.json')), {
    subagents: { defaultExtensions: [], agentScanDirs: ['integrations/pi-flow', 'home/pi-flow'] },
  });
});
