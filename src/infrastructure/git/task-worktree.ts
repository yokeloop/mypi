import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, writeFileSync, symlinkSync, readlinkSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// No checkout filters, hooks, fsmonitor or shared Git metadata in the worker.
function git(repository: string, args: string[], input?: string): Buffer {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '-c', 'gc.auto=0', '-C', repository, ...args], {
    env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    ...(input === undefined ? {} : { input }), timeout: 15_000, maxBuffer: 32 * 1024 * 1024,
  });
}
export function taskRevision(repository: string): string {
  const rev = git(repository, ['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim();
  if (!/^[a-f0-9]{40,64}$/.test(rev)) throw new Error('Invalid base revision');
  return rev;
}
export function createTaskWorktree(repository: string, directory: string, revision: string, branch: string): void {
  if (!/^[a-f0-9]{40,64}$/.test(revision) || !/^mypi\/[A-Z]+-[1-9][0-9]*-[a-f0-9]{32}$/.test(branch)) throw new Error('Invalid worktree identity');
  // Read/validate the entire committed tree before creating the worktree. Do not copy dirty files.
  const entries = git(repository, ['ls-tree', '-rz', '--full-tree', revision]).toString().split('\0').filter(Boolean).map(entry => {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40,64})\t(.+)$/.exec(entry);
    if (!match) throw new Error('Only regular files and in-tree symlinks are supported (no submodules)');
    const [, mode, hash, path] = match;
    if (path!.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git') || /[\0\r\n\\]/.test(path!)) throw new Error('Unsafe tree path');
    return { mode: mode!, hash: hash!, path: path! };
  });
  if (entries.length > 10000) throw new Error('Committed tree entry budget exceeded');
  const input = entries.map(e => e.hash).join('\n') + (entries.length ? '\n' : '');
  const sizes = entries.length ? git(repository, ['cat-file', '--batch-check=%(objectsize)'], input).toString().trim().split('\n').map(Number) : [];
  if (sizes.length !== entries.length || sizes.some(n => !Number.isSafeInteger(n) || n < 0)
    || sizes.reduce((a, b) => a + b, 0) > 31 * 1024 * 1024) throw new Error('Committed tree byte budget exceeded');
  const blobs = entries.length ? git(repository, ['cat-file', '--batch'], input) : Buffer.alloc(0);
  let offset = 0;
  const materialized = entries.map((entry, index) => {
    const end = blobs.indexOf(10, offset), size = sizes[index]!;
    if (end < 0 || blobs.subarray(offset, end).toString() !== entry.hash + ' blob ' + size) throw new Error('Invalid Git batch');
    const content = blobs.subarray(end + 1, end + 1 + size); offset = end + 2 + size;
    if (content.length !== size || blobs[offset - 1] !== 10) throw new Error('Truncated Git batch');
    return { ...entry, content };
  });
  git(repository, ['worktree', 'add', '--no-checkout', '-b', branch, '--', directory, revision]);
  // Once registered, failure is partial: preserve directory/ref and let the operator reconcile.
  for (const entry of materialized) {
    const target = join(directory, entry.path), content = entry.content;
    mkdirSync(dirname(target), { recursive: true });
    if (entry.mode === '120000') {
      const link = content.toString(), dest = relative(directory, resolve(dirname(target), link));
      if (link.startsWith('/') || !dest || dest.startsWith('../') || dest === '..' || link.includes('\0')) throw new Error('Out-of-scope symlink');
      symlinkSync(link, target);
    } else writeFileSync(target, content, { flag: 'wx', mode: entry.mode === '100755' ? 0o755 : 0o644 });
  }
  git(directory, ['read-tree', revision]);
  auditWorktree(directory);
}
export function auditWorktree(directory: string): void {
  const root = realpathSync(directory);
  function walk(path: string): void {
    for (const name of readdirSync(path)) {
      if (path === root && name === '.git') continue; // hidden by a read-only mount in the worker
      if (name.toLowerCase() === '.git') throw new Error('Nested Git metadata denied');
      const full = join(path, name), stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        const link = readlinkSync(full), dest = relative(root, resolve(dirname(full), link));
        if (link.startsWith('/') || dest === '..' || dest.startsWith('../')) throw new Error('Out-of-scope symlink');
        // Existing links must also resolve inside; dangling in-tree links remain harmless in the mount namespace.
        try { if (relative(root, realpathSync(full)).startsWith('../')) throw new Error('Out-of-scope symlink chain'); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      } else if (stat.isDirectory()) walk(full);
      else if (!stat.isFile() || stat.nlink !== 1) throw new Error('Special files and shared hardlinks denied');
    }
  }
  walk(root);
}
