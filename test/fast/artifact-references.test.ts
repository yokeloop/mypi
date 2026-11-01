import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArtifactReference } from '../../src/app/artifact-references.js';

test('an artifact reference resolves only through a reachable commit that contains its path', () => {
  const tip = 'a'.repeat(40), orphan = 'b'.repeat(40);
  const versions = { reaches: (commit: string) => commit === tip, contains: (commit: string, path: string) => commit === tip && path === 'a.md' };
  assert.doesNotThrow(() => checkArtifactReference({ path: 'a.md', commit: tip }, versions));
  assert.throws(() => checkArtifactReference({ path: 'a.md', commit: orphan }, versions), /Unresolvable artifact reference: a\.md@b{40}/);
  assert.throws(() => checkArtifactReference({ path: 'b.md', commit: tip }, versions), /Unresolvable artifact reference: b\.md@/);
  assert.throws(() => checkArtifactReference({ path: 'a.md', commit: tip }, undefined), /Unresolvable artifact reference: a\.md@/);
});
