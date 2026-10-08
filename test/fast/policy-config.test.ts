import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePolicyYaml, MAX_POLICY_BYTES } from '../../src/infrastructure/configuration/policy-yaml.js';
import { validatePolicyText, createRevisionedPolicySnapshot, loadPolicyConfiguration } from '../../src/app/policy-config.js';
import { DEFAULT_ALLOW, normalizePolicy } from '../../src/modules/authorization/public.js';

// Domain decisions are covered by authorization.test.ts; these cases protect syntax and composition only.
test('policy YAML rejects ambiguous syntax and bounds diagnostics; semantic validation stays public-core owned', () => {
  const valid = ['version: 1\n', '{version: 1}', '# comment\nversion: 1\nprofiles: {isolated: {}}'];
  for (const text of valid) assert.deepEqual(validatePolicyText(text).policy, normalizePolicy(parsePolicyYaml(text)));
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
  assert.throws(() => validatePolicyText('version: 9'), /Invalid policy version/);
  assert.throws(() => validatePolicyText('version: 1\nunknown: secret-value'), /unknown field/);
  assert.deepEqual(validatePolicyText('version: 1\nprofiles: {isolated: {}}').policy.profiles.isolated.allow, DEFAULT_ALLOW);
  assert.deepEqual(validatePolicyText('version: 1\nprofiles: {isolated: {allow: []}}').policy.profiles.isolated.allow, []);
});

test('policy revisions hash normalized immutable configuration, scope membership, caller and verified bindings', () => {
  const first = validatePolicyText('version: 1\ndefaults: {allow: [data.read, filesystem.read]}');
  const equivalent = validatePolicyText('defaults: {allow: [filesystem.read, data.read]}\nversion: 1\nprofiles: {isolated: {}}');
  assert.equal(first.revision, equivalent.revision);
  assert.match(first.revision, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(first.revision, validatePolicyText('version: 1\ndefaults: {allow: []}').revision);
  const projects = ['one/b', 'one/a'];
  const binding = { id: 'a', project: 'one/a', baseRoot: '/base', commonDir: '/base/.git', worktreeRoot: '/task', branch: 'task' };
  const input = { policy: first.policy, identity: { principal: { kind: 'agent' as const, id: 'worker' }, sessionId: 's', runtimeId: 'r' },
    scope: { kind: 'organization' as const, organization: 'one', projects }, profile: 'isolated' as const, bindings: [binding] };
  const snapshot = createRevisionedPolicySnapshot(input);
  assert.equal(snapshot.revision, createRevisionedPolicySnapshot({ ...input, policy: equivalent.policy,
    scope: { ...input.scope, projects: ['one/a', 'one/b', 'one/a'] } }).revision);
  assert.notEqual(snapshot.revision, createRevisionedPolicySnapshot({ ...input, scope: { ...input.scope, projects: ['one/a'] } }).revision);
  assert.notEqual(snapshot.revision, createRevisionedPolicySnapshot({ ...input, bindings: [{ ...binding, branch: 'other' }] }).revision);
  assert.notEqual(snapshot.revision, createRevisionedPolicySnapshot({ ...input, identity: { ...input.identity, sessionId: 'other' } }).revision);
  const unrestricted = { ...input, scope: { kind: 'unrestricted' as const } };
  assert.notEqual(createRevisionedPolicySnapshot(unrestricted).revision,
    createRevisionedPolicySnapshot({ ...unrestricted, profile: 'standard' }).revision);
  const configured = validatePolicyText('version: 1\nrepositories: {one/a: {root: /not-evidence}}');
  assert.deepEqual(createRevisionedPolicySnapshot({ ...input, policy: configured.policy, bindings: [] }).bindings, []);
  projects.push('one/new'); binding.branch = 'changed';
  assert.deepEqual(snapshot.scope, { kind: 'organization', organization: 'one', projects: ['one/a', 'one/b'] });
  assert.equal(snapshot.bindings[0]!.branch, 'task');
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.bindings[0]) && Object.isFrozen(first.policy.defaults.allow));
});

test('trusted policy sources are bounded regular files, fail closed, and never create or modify policy', t => {
  const home = mkdtempSync(join(tmpdir(), 'mypi-policy-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'pi'), { mode: 0o700 });
  const path = join(home, 'pi', 'mypi-policy.yaml'), text = 'version: 1\n';
  writeFileSync(path, text, { mode: 0o600 });
  const explicit = (path: string) => loadPolicyConfiguration({ kind: 'explicit', path });
  assert.deepEqual(loadPolicyConfiguration({ kind: 'operator-home', home }), validatePolicyText(text));
  assert.deepEqual(explicit(path), validatePolicyText(text));
  assert.equal(readFileSync(path, 'utf8'), text);
  assert.deepEqual(readdirSync(join(home, 'pi')), ['mypi-policy.yaml']);
  assert.throws(() => explicit(join(home, 'absent', 'policy.yaml')), /unavailable or unsafe/);
  assert.deepEqual(readdirSync(home), ['pi'], 'missing source must not initialize directories');
  assert.throws(() => explicit(join(home, 'pi')), /unavailable or unsafe/);
  symlinkSync(path, join(home, 'alias'));
  symlinkSync(join(home, 'missing'), join(home, 'dangling'));
  symlinkSync(join(home, 'pi'), join(home, 'parent-alias'));
  for (const unsafe of ['alias', 'dangling', 'parent-alias/mypi-policy.yaml']) {
    assert.throws(() => explicit(join(home, unsafe)), /unavailable or unsafe/);
  }
  linkSync(path, join(home, 'hardlink'));
  assert.throws(() => explicit(path), /unavailable or unsafe/);
  rmSync(join(home, 'hardlink'));
  chmodSync(path, 0o622);
  assert.throws(() => explicit(path), /unavailable or unsafe/);
  chmodSync(path, 0o600);
  chmodSync(join(home, 'pi'), 0o722);
  assert.throws(() => explicit(path), /unavailable or unsafe/);
  chmodSync(join(home, 'pi'), 0o700);
  writeFileSync(path, 'version: 2');
  assert.throws(() => explicit(path), /Invalid policy version/);
  assert.equal(readFileSync(path, 'utf8'), 'version: 2', 'invalid policy is not repaired');
  writeFileSync(path, Buffer.from([0xff]));
  assert.throws(() => explicit(path), /unavailable or unsafe/);
  writeFileSync(path, '#'.repeat(MAX_POLICY_BYTES + 1));
  assert.throws(() => explicit(path), /65536 bytes/);
});
