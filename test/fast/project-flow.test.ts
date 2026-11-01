import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow, taskBranchName, validBranchName, DEFAULT_TASK_BRANCH } from '../../src/modules/projects/public.js';

const file = '/home/projects/one/project/flow.json';

test('a flow parses its explicit fields as given, without defaults', () => {
  assert.deepEqual(parseFlow('{}', file), {});
  const full = { integration: 'develop', taskBranch: 'feature/{KEY}-{slug}', prTarget: 'develop', mergeMethod: 'squash', release: 'docs/RELEASE.md' };
  assert.deepEqual(parseFlow(JSON.stringify(full), file), full);
  assert.deepEqual(parseFlow('{"release":"https://example.test/release"}', file), { release: 'https://example.test/release' });
  assert.equal(DEFAULT_TASK_BRANCH, 'task/{KEY}-{slug}');
  assert.equal(taskBranchName('feature/{KEY}-{slug}', 'MP-1', 'a'), 'feature/MP-1-a');
  assert.equal(taskBranchName('{KEY}/{KEY}-{slug}{slug}', 'MP-1', 'a'), 'MP-1/MP-1-aa');
});

test('an invalid flow is refused with the file and the field', () => {
  const cases: [string, string][] = [
    ['{', 'not valid JSON'],
    ['[]', 'must be a JSON object'],
    ['null', 'must be a JSON object'],
    ['"develop"', 'must be a JSON object'],
    ['{"preset":"gitflow"}', 'unknown field preset'],
    ['{"integration":7}', 'integration must be a valid branch name'],
    ['{"integration":"bad..name"}', 'integration must be a valid branch name'],
    ['{"prTarget":"-x"}', 'prTarget must be a valid branch name'],
    ['{"taskBranch":["task/{KEY}"]}', 'taskBranch must be a string'],
    ['{"taskBranch":"task/{slug}"}', 'taskBranch must contain {KEY}'],
    ['{"taskBranch":"task/{KEY}-{title}"}', 'taskBranch may use only the placeholders {KEY} and {slug}'],
    ['{"taskBranch":"task/{KEY}}"}', 'taskBranch may use only the placeholders {KEY} and {slug}'],
    ['{"taskBranch":"task/{KEY}.lock"}', 'taskBranch must give a valid branch name'],
    ['{"taskBranch":"task//{KEY}"}', 'taskBranch must give a valid branch name'],
    ['{"mergeMethod":"fast-forward"}', 'mergeMethod must be merge, squash or rebase'],
    ['{"mergeMethod":1}', 'mergeMethod must be merge, squash or rebase'],
  ];
  const release = 'release must be an https URL or a path relative to the project\'s clone';
  for (const value of [1, '', '  ', 'docs/\u0007.md', '/etc/release.md', 'docs/../RELEASE.md', 'http://example.test/release', 'ftp://example.test/r', 'https://']) {
    cases.push([JSON.stringify({ release: value }), release]);
  }
  for (const [text, message] of cases) {
    assert.throws(() => parseFlow(text, file), (error: Error) => error.name === 'InputError'
      && error.message === 'Invalid flow ' + file + ': ' + message, text);
  }
});

test('branch names follow git check-ref-format --branch', () => {
  for (const name of ['main', 'develop', 'feature/MP-1-a', 'release/1.2', 'a@b', 'x.y/z']) assert.equal(validBranchName(name), true, name);
  for (const name of ['', '@', '-x', 'a\u0001b', 'a\u007fb', 'a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b',
    'a..b', 'a@{b', 'a//b', '/a', 'a/', 'a.', '.a', 'a/.b', 'a.lock', 'a/b.lock/c']) {
    assert.equal(validBranchName(name), false, JSON.stringify(name));
  }
});
