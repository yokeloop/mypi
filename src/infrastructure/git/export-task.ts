import { execFileSync } from 'node:child_process';
import { join, basename, dirname, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

export function exportTaskCommit(repository: string, worktree: string, agent: string, revision: string, key: string): string {
  const branch = 'refs/heads/mypi/' + key + '-' + basename(dirname(worktree));
  const env = { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' };
  const git = (args: string[], input?: Buffer) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '-c', 'submodule.recurse=false', '-C', repository, ...args], {
    env, ...(input === undefined ? {} : { input }), timeout: 15000, maxBuffer: 32 * 1024 * 1024,
  });
  const common = realpathSync(resolve(repository, git(['rev-parse', '--git-common-dir']).toString().trim()));
  const workCommon = realpathSync(resolve(worktree, git(['-C', worktree, 'rev-parse', '--git-common-dir']).toString().trim()));
  if (common !== workCommon || git(['-C', worktree, 'symbolic-ref', 'HEAD']).toString().trim() !== branch) throw new Error('Assigned worktree identity changed');
  if (!existsSync(join(agent, 'git'))) throw new Error('No private Git state');
  // Even after stop, worker Git config/objects are untrusted. Never execute that Git on the host.
  const isolated = (args: string[]) => execFileSync('bwrap', ['--unshare-all', '--unshare-user', '--disable-userns', '--new-session',
    '--die-with-parent', '--cap-drop', 'ALL', '--clearenv', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--dir', '/home', '--dir', '/home/worker', '--ro-bind', agent, '/home/worker/agent', '--ro-bind', worktree, '/work',
    '--setenv', 'PATH', '/usr/bin', '--setenv', 'HOME', '/tmp', '--setenv', 'GIT_CONFIG_NOSYSTEM', '1',
    '--setenv', 'GIT_CONFIG_GLOBAL', '/dev/null', '--chdir', '/work', '/usr/bin/git',
    '--git-dir=/home/worker/agent/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    timeout: 15000, maxBuffer: 32 * 1024 * 1024, env,
  });
  const head = isolated(['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim();
  if (!/^[a-f0-9]{40,64}$/.test(head) || !/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Invalid export commit');
  isolated(['merge-base', '--is-ancestor', revision, head]);
  const before = git(['rev-parse', '--verify', branch]).toString().trim();
  if (before === head) { git(['-C', worktree, 'read-tree', head]); return head; }
  const pack = isolated(['pack-objects', '--all', '--stdout', '--threads=1', '--window=0', '--no-reuse-delta']);
  // Only object data is imported; never worker config/hooks/refs. A CAS updates one preassigned ref.
  git(['index-pack', '--stdin', '--strict', '--threads=1'], pack);
  git(['merge-base', '--is-ancestor', revision, head]);
  git(['merge-base', '--is-ancestor', before, head]);
  git(['update-ref', branch, head, before]);
  git(['-C', worktree, 'read-tree', head]);
  return head;
}
