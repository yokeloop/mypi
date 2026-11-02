import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_REPOSITORY, checkoutTarget, noRepositoryError, planCheckout, validateRepository } from '../../src/modules/projects/public.js';

test('a repository is a Git remote URL, an absolute path or local', () => {
  assert.equal(LOCAL_REPOSITORY, 'local');
  for (const value of ['local', 'https://github.com/o/r.git', 'ssh://git@host/o/r.git', 'git@github.com:o/r.git',
    'host:path', 'file:///srv/r.git', '/srv/r.git']) assert.doesNotThrow(() => validateRepository(value), value);
  const cases: [string, string][] = [
    ['', 'must not be empty'],
    ['-uhttps://x', 'must not start with -'],
    ['ext::sh -c x', 'must not contain spaces or control characters'],
    ['a::b', 'transport helpers (::) are not allowed'],
    ['https://x/\n', 'must not contain spaces or control characters'],
    ['http://x/r', 'scheme http is not allowed'],
    ['git://x/r', 'scheme git is not allowed'],
    ['relative/path', 'is not a Git remote URL'],
    ['with space:x', 'must not contain spaces or control characters'],
  ];
  for (const [value, reason] of cases) {
    assert.throws(() => validateRepository(value), {
      name: 'InputError',
      message: 'Invalid repository ' + JSON.stringify(value) + ': ' + reason
        + '; use https://, ssh://, file://, [user@]host:path, an absolute path or local',
    }, value);
  }
});

test('a checkout is planned from the repository and the state of its target', () => {
  const target = checkoutTarget('/engine/projects', { org: 'one', slug: 'project' });
  assert.equal(target, '/engine/projects/one/project');
  const url = { org: 'one', slug: 'project', code: 'MP', repository: 'git@github.com:one/project.git' };
  const local = { ...url, repository: 'local' };
  const none = { ...url, repository: null };
  assert.throws(() => planCheckout(none, target, { kind: 'missing' }), { message: noRepositoryError(none).message });
  assert.match(noRepositoryError(none).message, /^Project one\/project \(MP\) has no clone and no repository to clone it from; set it with projects \{"action":"update","identity":"one\/project","expectedRepository":null,"repository":"<git-url\|local>"\} \(CLI: mypi project update one\/project --expected-repository-unset --repository <git-url\|local>\), then open it again$/);
  assert.equal(planCheckout(url, target, { kind: 'missing' }), 'clone');
  assert.equal(planCheckout(url, target, { kind: 'empty' }), 'clone');
  assert.equal(planCheckout(local, target, { kind: 'missing' }), 'init');
  assert.equal(planCheckout(local, target, { kind: 'empty' }), 'init');
  assert.equal(planCheckout(url, target, { kind: 'repository', origin: url.repository }), 'adopt');
  assert.equal(planCheckout(local, target, { kind: 'repository', origin: null }), 'adopt');
  const refused = (why: string) => 'Cannot prepare the clone of one/project: ' + target + ' ' + why
    + '; nothing was changed. Move it away, or register an existing clone with mypi project update one/project --expected-unset --path <checkout>';
  assert.throws(() => planCheckout(url, target, { kind: 'repository', origin: 'git@github.com:one/project' }),
    { name: 'InputError', message: refused('is a Git repository with origin git@github.com:one/project, not ' + url.repository) });
  assert.throws(() => planCheckout(url, target, { kind: 'repository', origin: null }),
    { message: refused('is a Git repository with origin none, not ' + url.repository) });
  assert.throws(() => planCheckout(local, target, { kind: 'repository', origin: '/srv/r.git' }),
    { message: refused('is a Git repository with origin /srv/r.git, but the project is local') });
  assert.throws(() => planCheckout(url, target, { kind: 'other', reason: 'is a symbolic link' }),
    { message: refused('is a symbolic link') });
});
