import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { createChangeFeed } from '../../src/app/change-feed.js';

test('change feed counts commits of other connections once and stays still without them', t => {
  const { filename } = state(t);
  const feed = createChangeFeed(filename);
  t.after(() => feed.close());
  assert.equal(feed.changeId(), 1);
  assert.equal(feed.poll(), false);
  const app = createApp(filename, false);
  try { app.projects.add('one/project', 'MP'); } finally { app.close(); }
  assert.equal(feed.poll(), true);
  assert.equal(feed.changeId(), 2);
  assert.equal(feed.poll(), false);
  const reader = createApp(filename, true);
  try { reader.projects.list(); } finally { reader.close(); }
  assert.equal(feed.poll(), false);
  assert.equal(feed.changeId(), 2);
});
