import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextFiles } from '../filesystem/context-files.js';
import { InputError } from '../../shared/errors.js';
import { contextGit } from './context-git.js';

export function backupGit(root: string) {
  const files = contextFiles(root);
  const run = (args: string[], index?: string, input?: Buffer): string => {
    const result = spawnSync('git', ['--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'user.name=mypi', '-c', 'user.email=mypi@localhost', '-C', root, ...args],
    { encoding: 'utf8', input, timeout: 5000, maxBuffer: 8 * 1024 * 1024,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), ...(index ? { GIT_INDEX_FILE: index } : {}) } });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Git failed');
    return result.stdout;
  };
  const head = () => contextGit(root).head();
  const branch = () => {
    contextGit(root).inspectRepository();
    if (run(['symbolic-ref', '--quiet', 'HEAD']).trim() !== 'refs/heads/main') throw new InputError('Home must be on main');
    const remote = run(['config', '--get', 'remote.origin.url']).trim();
    if (!remote) throw new InputError('Existing origin remote required');
    return remote;
  };
  const tracked = (revision: string) => run(['ls-tree', '-r', '-z', '--name-only', revision]).split('\0').filter(Boolean);
  const mode = (revision: string, path: string) => run(['ls-tree', revision, '--', path]).split(/\s/)[0] ?? '';
  function safe(path: string): void {
    if (path === 'pi/APPEND_SYSTEM.md') {
      if (readlinkSync(join(root, path)) !== '../USER-INSTRUCTIONS.md' || !files.isFile('USER-INSTRUCTIONS.md')) throw new InputError('Unsafe instruction link');
      files.path('pi');
    } else if (!lstatSync(files.path(path)).isFile()) throw new InputError('Only regular files may be published');
  }
  function stagedEntries(): string[] { return run(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean); }
  function changed(): string[] { return run(['status', '--porcelain=v1', '--untracked-files=all', '-z']).split('\0').filter(Boolean).map(line => line.slice(3)); }
  function ignored(path: string): boolean {
    const result = spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', path], { timeout: 3000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) });
    if (result.error || ![0, 1].includes(result.status ?? -1)) throw new Error('Git ignore check failed');
    return result.status === 0;
  }
  function commit(base: string, selected: ReadonlyMap<string, Buffer | string>): string {
    if (head() !== base) throw new InputError('Home HEAD changed during backup');
    const temp = mkdtempSync(join(tmpdir(), 'mypi-backup-index-'));
    try {
      const index = join(temp, 'index');
      run(['read-tree', base], index);
      for (const [path, content] of selected) {
        const blob = run(['hash-object', '-w', '--stdin'], undefined, typeof content === 'string' ? Buffer.from(content) : content).trim();
        run(['update-index', '--add', '--cacheinfo', (path === 'pi/APPEND_SYSTEM.md' ? '120000' : '100644') + ',' + blob + ',' + path], index);
      }
      const tree = run(['write-tree'], index).trim();
      const commit = run(['commit-tree', tree, '-p', base, '-m', 'Publish mypi backup']).trim();
      // CAS protects another writer's commit; no merge or implicit branch rewrite.
      run(['update-ref', 'refs/heads/main', commit, base]);
      return commit;
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
  function remoteHead(): string | undefined {
    const text = run(['ls-remote', '--heads', 'origin', 'refs/heads/main']).trim();
    return text ? text.split('\t')[0] : undefined;
  }
  return { run, head, branch, tracked, mode, safe, stagedEntries, changed, ignored, commit, remoteHead,
    push(commit: string) { run(['push', 'origin', commit + ':refs/heads/main']); },
    read(revision: string, path: string): Buffer {
      const result = spawnSync('git', ['-C', root, 'show', revision + ':' + path], { encoding: 'buffer', timeout: 5000,
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) });
      if (result.error || result.status !== 0) throw new Error(result.error?.message || 'Git object read failed');
      return result.stdout;
    } };
}

export function clonePublishedCommit(repository: string, commit: string, root: string): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const command = (args: string[]) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      { encoding: 'utf8', timeout: 5000, env });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim());
  };
  command(['clone', '--quiet', '--no-checkout', '--', repository, root]);
  command(['-C', root, '-c', 'core.autocrlf=false', 'checkout', '--quiet', '--detach', commit]);
}
