import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contextGit } from '../../src/infrastructure/git/context-git.js';

export function homeGit(root: string, ...args: string[]): string {
  const result = spawnSync('/usr/bin/git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@localhost', '-C', root, ...args], {
    encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
}

/** Disposable configured origin/main, shared by actual managed-entrypoint fixtures. */
export function configureHome(root: string): { remote: string } {
  const git = contextGit(root); git.initialize();
  writeFileSync(join(root, '.gitignore'), 'cache/\n');
  git.commit(['.gitignore'], 'Fixture initial home');
  const remote = root + '-origin.git';
  homeGit(root, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  homeGit(root, 'remote', 'add', 'origin', remote);
  homeGit(root, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  return { remote };
}
