import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadGuardPolicyConfiguration, validateGuardPolicyText } from '../../src/app/guard-policy-config.js';
import { MAX_POLICY_BYTES } from '../../src/infrastructure/configuration/policy-yaml.js';
import { InputError } from '../../src/shared/errors.js';

// The existing policy-config syntax table covers YAML ambiguity and parser budgets.
// These cases protect composition with the version-2 model, not a second syntax matrix.
test('guard policy text delegates syntax and schema validation without losing diagnostics', () => {
  assert.deepEqual(validateGuardPolicyText('version: 2'), {
    version: 2,
    guards: { outsideWorktreeWrite: 'block', baseCheckoutWrite: 'block', foreignMypiTarget: 'block' },
  });
  assert.deepEqual(validateGuardPolicyText('version: 2\nguards: {outsideWorktreeWrite: warn}'), {
    version: 2,
    guards: { outsideWorktreeWrite: 'warn', baseCheckoutWrite: 'block', foreignMypiTarget: 'block' },
  });
  const invalid: readonly [string, RegExp][] = [
    ['version: [', /valid YAML/],
    ['version: 1\nprofiles: {isolated: {}}', /version 1 is incompatible; use version 2/],
    ['version: 9', /version: expected 2/],
    ['version: 2\nprofiles: {}', /unknown field/],
    ['version: 2\nguards: {foreignMypiTarget: allow}', /expected warn or block/],
  ];
  for (const [text, message] of invalid) {
    assert.throws(() => validateGuardPolicyText(text), { name: 'InputError', message });
  }
});

test('selected guard policy files are bounded UTF-8 regular files and are never created or repaired', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mypi-guard-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'policy.yaml');
  const text = 'version: 2\nguards: {baseCheckoutWrite: warn, foreignMypiTarget: warn}\n';
  writeFileSync(path, text);
  const expected = {
    version: 2,
    guards: { outsideWorktreeWrite: 'block', baseCheckoutWrite: 'warn', foreignMypiTarget: 'warn' },
  };
  assert.deepEqual(loadGuardPolicyConfiguration(path), expected);
  assert.deepEqual(loadGuardPolicyConfiguration(relative(process.cwd(), path)), expected);
  symlinkSync(path, join(directory, 'alias.yaml'));
  assert.deepEqual(loadGuardPolicyConfiguration(join(directory, 'alias.yaml')), expected);
  assert.equal(readFileSync(path, 'utf8'), text);
  assert.throws(() => loadGuardPolicyConfiguration(join(directory, 'missing', 'policy.yaml')), /source unavailable/);
  assert.throws(() => loadGuardPolicyConfiguration(directory), /regular file/);
  assert.deepEqual(readdirSync(directory), ['alias.yaml', 'policy.yaml'], 'loading must not initialize missing paths');

  const exactLimit = text + '#' + 'x'.repeat(MAX_POLICY_BYTES - Buffer.byteLength(text) - 1);
  writeFileSync(path, exactLimit);
  assert.deepEqual(loadGuardPolicyConfiguration(path), expected, 'the byte limit is inclusive');
  const invalid: readonly [string | Buffer, RegExp][] = [
    ['version: [', /valid YAML/],
    ['version: 1', /version 1 is incompatible/],
    [Buffer.from([0xff]), /valid UTF-8/],
    [exactLimit + 'x', /65536 bytes/],
  ];
  for (const [content, message] of invalid) {
    writeFileSync(path, content);
    assert.throws(() => loadGuardPolicyConfiguration(path), error => {
      assert.ok(error instanceof InputError);
      assert.match(error.message, message);
      return true;
    });
    assert.deepEqual(readFileSync(path), Buffer.from(content), 'invalid input must not be repaired');
  }
  assert.deepEqual(readdirSync(directory), ['alias.yaml', 'policy.yaml']);
});
