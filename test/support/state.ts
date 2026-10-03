import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import { initializeState } from '../../src/app/create-app.js';

export function state(t: TestContext): { dir: string; filename: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'state.sqlite3');
  initializeState(filename);
  return { dir, filename };
}
