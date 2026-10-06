import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Real local Git commits/tags with a simulated remote, CI and pnpm: no network or credentials.
test('release commits and tags the same version, publishes only after checks, and resumes without rewriting refs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'checkout'), bin = join(dir, 'bin');
  mkdirSync(root); mkdirSync(bin);
  const env = { ...process.env, HOME: join(dir, 'user'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', RELEASE_FIXTURE: dir, PATH: `${bin}:/work/tools:/usr/bin` };
  mkdirSync(env.HOME);
  function command(cwd: string, command: string, args: string[], extra: Record<string, string> = {}) {
    const result = spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 8000 });
    assert.equal(result.error, undefined);
    return result;
  }
  function git(cwd: string, ...args: string[]) {
    const result = command(cwd, 'git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.org');
  git(root, 'remote', 'add', 'origin', 'https://github.com/yokeloop/mypi.git');
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'src/mcp'), { recursive: true });
  cpSync('/work/scripts/release.mjs', join(root, 'scripts/release.mjs'));
  writeFileSync(join(root, 'package.json'), '{"version": "0.1.1"}\n');
  writeFileSync(join(root, 'src/mcp/server.ts'), "new McpServer({ name: 'mypi', version: '0.1.1' })\n");
  git(root, 'add', '.'); git(root, 'commit', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'remote-head'), base);
  writeFileSync(join(bin, 'git'), `#!/usr/bin/bash
if [[ "$1" == ls-remote && "$2" == origin ]]; then
  case "$3" in
    refs/heads/main) printf '%s\\t%s\\n' "$(cat "$RELEASE_FIXTURE/remote-head")" "$3" ;;
    refs/tags/v0.1.2*)
      if [[ -f "$RELEASE_FIXTURE/remote-tag" ]]; then
        printf '%s\\t%s\\n' "$(cat "$RELEASE_FIXTURE/remote-tag")" "$3"
      fi ;;
  esac
  exit 0
fi
if [[ "$1" == push && "$2" == --atomic ]]; then
  /usr/bin/git rev-parse HEAD > "$RELEASE_FIXTURE/remote-head"
  /usr/bin/git rev-parse 'v0.1.2^{}' > "$RELEASE_FIXTURE/remote-tag"
  exit 0
fi
exec /usr/bin/git "$@"
`, { mode: 0o755 });
  writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/sh\necho "$1" >> "$RELEASE_FIXTURE/checks"\n[ "$1" != verify ] || [ "${FAIL_VERIFY:-}" != 1 ]\n', { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/sh
case "$1 $2" in
  'auth status') exit 0 ;;
  'run list')
    sha=$(git rev-parse HEAD)
    printf '[{"databaseId":1,"headSha":"%s","status":"completed","conclusion":"success","url":"https://example.test/ci"}]\\n' "$sha"
    ;;
  'release view')
    [ -f "$RELEASE_FIXTURE/release" ] || exit 1
    printf '{"url":"https://example.test/release","isDraft":false,"tagName":"v0.1.2"}\\n'
    ;;
  'release create')
    [ "$(git rev-parse v0.1.2^{})" = "$(git rev-parse HEAD)" ] || exit 1
    [ ! -f "$RELEASE_FIXTURE/release" ] || exit 1
    printf published > "$RELEASE_FIXTURE/release"
    ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  function release(extra: Record<string, string> = {}) {
    return command(root, process.execPath, ['scripts/release.mjs', '0.1.2'], extra);
  }
  const failed = release({ FAIL_VERIFY: '1' });
  assert.notEqual(failed.status, 0);
  assert.equal(git(root, 'rev-parse', 'HEAD'), base);
  assert.equal(readFileSync(join(dir, 'remote-head'), 'utf8').trim(), base);
  assert.equal(git(root, 'tag', '-l', 'v0.1.2'), '');
  assert.equal(existsSync(join(dir, 'release')), false);
  git(root, 'restore', '--', 'package.json', 'src/mcp/server.ts');
  const success = release();
  assert.equal(success.status, 0, success.stderr);
  const target = git(root, 'rev-parse', 'HEAD');
  assert.notEqual(target, base);
  assert.equal(git(root, 'rev-parse', 'v0.1.2^{}'), target);
  assert.equal(readFileSync(join(dir, 'remote-head'), 'utf8').trim(), target);
  assert.equal(readFileSync(join(dir, 'remote-tag'), 'utf8').trim(), target);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '0.1.2');
  assert.match(readFileSync(join(root, 'src/mcp/server.ts'), 'utf8'), /version: '0\.1\.2'/);
  assert.equal(readFileSync(join(dir, 'release'), 'utf8'), 'published');
  const retry = release();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(git(root, 'rev-parse', 'HEAD'), target);
  assert.equal(git(root, 'status', '--porcelain=v1'), '');
  assert.equal(readFileSync(join(dir, 'checks'), 'utf8'), 'build\nverify\nbuild\nverify\n');
});
