import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWizard, advance, back, move, setHome, setStorage, editFromPreview, returnFromEdit } from '../../src/cli/bootstrap-model.js';

test('wizard retains independent choices on return and resets only dependent remote', () => {
  const start = initialWizard();
  const home = setHome(advance(start, 'homeMode'), 'clone', '/tmp/home');
  const storage = setStorage(advance(home, 'storage'), 'recommended', { database: '/tmp/db', stateRoot: '/tmp/runtime' });
  const updated = setHome({ ...storage, answers: { ...storage.answers, remote: 'git@example/repo' } }, 'new', '/tmp/other');
  assert.equal(updated.answers.remote, undefined);
  assert.equal(updated.answers.database, '/tmp/db');
  assert.equal(updated.answers.stateRoot, '/tmp/runtime');
  assert.equal(back(advance(storage, 'database')).screen, 'storage');
});
test('preview edit returns to review and safe consent starts at Back', () => {
  const w = advance(initialWizard(), 'preview');
  assert.equal(returnFromEdit(editFromPreview(w, 'database')).screen, 'preview');
  assert.equal(advance(w, 'applyConsent').selection, 0);
  assert.equal(advance(w, 'cloneConsent').selection, 0);
  assert.equal(move(w, 100, 7).selection, 6);
});
