import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePolicyYaml, MAX_POLICY_BYTES } from '../../src/infrastructure/configuration/policy-yaml.js';

// Retained syntax coverage; version-2 composition/file loading lives in guard-policy-config.test.ts.
test('policy YAML rejects ambiguous syntax and bounds diagnostics independently of schema', () => {
  for (const text of ['version: 2\n', '{version: 2}', '# comment\nversion: 2']) {
    assert.deepEqual(parsePolicyYaml(text), { version: 2 });
  }
  const invalid: readonly [string, RegExp][] = [
    ['version: 1\nversion: 1', /unique/],
    ['1: value', /keys must be strings/], ['? [version]\n: 1', /keys must be strings/],
    ['version: &anchor 1', /anchors/], ['version: *anchor', /aliases/],
    ['version: 1\n<<: {}', /merge/], ['version: !custom 1', /core tags/],
    ['version: 1\n---\nversion: 1', /one document/], ['version: [', /valid YAML/],
    ['%YAML 1.1\n---\nversion: 1', /YAML 1.2/],
    ['x: ' + '['.repeat(66) + '0' + ']'.repeat(66), /nesting/],
    ['[' + '0,'.repeat(4097) + ']', /4096 nodes/],
    ['#' + 'é'.repeat(MAX_POLICY_BYTES / 2), /65536 bytes/],
  ];
  for (const [text, expected] of invalid) assert.throws(() => parsePolicyYaml(text), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, expected);
    assert.ok(error.message.length < 240, 'bounded diagnostics without source excerpts');
    return true;
  }, expected.source);
  assert.deepEqual(parsePolicyYaml('version: 9'), { version: 9 }, 'syntax adapter does not own policy versions');
});
