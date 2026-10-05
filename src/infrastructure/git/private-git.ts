import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, lstatSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const limit = 32 * 1024 * 1024;
function git(directory: string, args: string[], input?: Buffer | string): Buffer {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '-c', 'gc.auto=0', '-C', directory, ...args], {
    env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    ...(input === undefined ? {} : { input }), timeout: 15_000, maxBuffer: limit,
  });
}
// Only the selected commit/tree is exposed. No shared refs/config, credentials, hooks or history.
export function createPrivateGit(repository: string, directory: string, revision: string, branch: string): void {
  if (!/^[a-f0-9]{40,64}$/.test(revision) || !/^mypi\/[A-Z]+-[1-9][0-9]*-[a-f0-9]{32}$/.test(branch)) throw new Error('Invalid private Git identity');
  const tree = git(repository, ['rev-parse', revision + '^{tree}']).toString().trim();
  const ids = git(repository, ['ls-tree', '-r', '-t', '-z', revision]).toString().split('\0').filter(Boolean).map(line => {
    const hash = /^\d+ (?:blob|tree) ([a-f0-9]{40,64})\t/.exec(line)?.[1];
    if (!hash) throw new Error('Unsupported Git entry');
    return hash;
  });
  const pack = git(repository, ['pack-objects', '--stdout', '--threads=1', '--window=0', '--no-reuse-delta'],
    [...new Set([revision, tree, ...ids])].join('\n') + '\n');
  git(repository, ['init', '--bare', '--quiet', '--object-format=' + (revision.length === 64 ? 'sha256' : 'sha1'), directory]);
  git(directory, ['index-pack', '--stdin', '--threads=1'], pack);
  git(directory, ['update-ref', 'refs/heads/' + branch, revision]);
  git(directory, ['symbolic-ref', 'HEAD', 'refs/heads/' + branch]);
  git(directory, ['read-tree', revision]);
  writeFileSync(join(directory, 'shallow'), revision + '\n');
  writeFileSync(join(directory, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\nworktree = /work\n[user]\nname = mypi task worker\nemail = task@localhost\n');
}
export function copyPrivateTree(from: string, to: string): void {
  let bytes = 0, entries = 0;
  function copy(source: string, target: string): void {
    const info = lstatSync(source);
    if (++entries > 10000) throw new Error('Private state entry budget exceeded');
    if (info.isDirectory()) {
      mkdirSync(target, { mode: 0o700 });
      for (const name of readdirSync(source)) copy(join(source, name), join(target, name));
    } else if (info.isFile() && info.nlink === 1 && (bytes += info.size) <= limit) copyFileSync(source, target);
    else throw new Error('Private state must contain bounded, unlinked regular files');
  }
  copy(from, to);
}
