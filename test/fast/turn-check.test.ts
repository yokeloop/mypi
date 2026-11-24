import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { startedByParent } from '../../src/modules/events/public.js';
import { claudeTurnPrompt } from '../../src/infrastructure/transcript/claude-transcript.js';
import { claudeTurnActions } from '../../src/infrastructure/transcript/claude-turn.js';

function turn(t: TestContext) {
  const { dir, filename } = state(t);
  const home = join(dir, 'home'), tmp = join(dir, 'tmp');
  mkdirSync(join(home, 'projects/one/project/tasks/MP-12-scoped-warmup'), { recursive: true });
  mkdirSync(tmp);
  const transcript = (name: string) => {
    const path = join(dir, name);
    writeFileSync(path, readFileSync(new URL('../../../test/fixtures/turn/' + name, import.meta.url), 'utf8')
      .replaceAll('{{HOME}}', home).replaceAll('{{TMP}}', tmp));
    return path;
  };
  return { dir, filename, home, tmp, transcript };
}

test('claude turn actions are the tool calls after the turn prompt, in order, with the record cwd', t => {
  const { dir, home, tmp, transcript } = turn(t);
  const path = transcript('parent-block.jsonl');
  assert.equal(startedByParent(claudeTurnPrompt(path)), true);
  assert.deepEqual(claudeTurnActions(path), [
    { kind: 'write', path: tmp + '/notes.md', cwd: '/work', content: '# Notes\n' },
    { kind: 'bash', command: 'cp ' + tmp + '/notes.md ' + home + '/projects/one/project/tasks/MP-12-scoped-warmup/', cwd: '/other' }]);
  assert.equal(claudeTurnActions(join(dir, 'missing.jsonl')), undefined);
});
