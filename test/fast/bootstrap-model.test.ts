import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWizard, advance, back, move, setHome, setStorage, editFromPreview, returnFromEdit, afterHomeClone, clonedHomeMatchesSelection } from '../../src/cli/bootstrap-model.js';

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
test('recommended storage replaces custom paths after Back; absent suggestions clear them', () => {
  const defaults = { database: '/state/recommended.sqlite3', stateRoot: '/state/runtime' };
  const storage = advance(initialWizard(), 'storage');
  const custom = setStorage(storage, 'custom', defaults);
  const edited = { ...custom, answers: { ...custom.answers, database: '/other/custom.sqlite3', stateRoot: '/other/runtime' } };
  assert.equal(setStorage(edited, 'custom', defaults).answers.database, '/other/custom.sqlite3');
  assert.equal(setStorage(edited, 'custom', defaults).answers.stateRoot, '/other/runtime');
  const reviewed = advance(advance(advance(edited, 'database'), 'stateRoot'), 'preview');
  const returned = back(back(back(reviewed)));
  assert.equal(returned.screen, 'storage');
  assert.equal(returned.answers.database, '/other/custom.sqlite3');
  const recommended = setStorage(returned, 'recommended', defaults);
  assert.deepEqual([recommended.answers.databaseMode, recommended.answers.database, recommended.answers.stateRoot],
    ['new', defaults.database, defaults.stateRoot]);
  const missing = setStorage(returned, 'recommended', {});
  assert.equal(missing.answers.database, undefined);
  assert.equal(missing.answers.stateRoot, undefined);
  assert.equal('database' in missing.answers, false);
  assert.equal('stateRoot' in missing.answers, false);
  const existing = setStorage({ ...edited, answers: { ...edited.answers, databaseMode: 'existing' } }, 'existing', defaults);
  assert.equal(existing.answers.database, '/other/custom.sqlite3');
  assert.equal(existing.answers.stateRoot, '/other/runtime');
});
test('completed clone fences earlier home choices while storage and review remain editable', () => {
  const home = setHome(advance(initialWizard(), 'homeMode'), 'clone', '/tmp/cloned');
  const consent = advance(advance(advance(home, 'homeRoot'), 'remote'), 'cloneConsent');
  const cloned = afterHomeClone({ ...consent, answers: { ...consent.answers, remote: '/tmp/source' } }, '/tmp/cloned');
  assert.equal(cloned.screen, 'storage');
  assert.deepEqual(cloned.history, []);
  assert.equal(cloned.answers.remote, undefined);
  assert.equal(back(cloned), cloned); // Both Esc and visible Back use this boundary.
  const chosen = setStorage(cloned, 'custom', { database: '/tmp/db', stateRoot: '/tmp/runtime' });
  const database = advance(chosen, 'database');
  assert.equal(back(database).screen, 'storage');
  assert.equal(back(back(database)).screen, 'storage');
  const review = advance(advance(database, 'stateRoot'), 'preview');
  assert.equal(returnFromEdit(editFromPreview(review, 'database')).screen, 'preview');
  assert.equal(returnFromEdit(editFromPreview(review, 'stateRoot')).screen, 'preview');
  assert.equal(clonedHomeMatchesSelection(review), true);
  assert.equal(clonedHomeMatchesSelection({ ...review, answers: { ...review.answers, homeRoot: '/tmp/other' } }), false);
  assert.equal(clonedHomeMatchesSelection({ ...review, answers: { ...review.answers, homeMode: 'new' } }), false);
  assert.equal(clonedHomeMatchesSelection({ ...review, answers: { ...review.answers, remote: '/tmp/other' } }), false);
});
test('preview edit returns to review and safe consent starts at Back', () => {
  const w = advance(initialWizard(), 'preview');
  assert.equal(returnFromEdit(editFromPreview(w, 'database')).screen, 'preview');
  assert.equal(advance(w, 'applyConsent').selection, 0);
  assert.equal(advance(w, 'cloneConsent').selection, 0);
  assert.equal(move(w, 100, 7).selection, 6);
});
