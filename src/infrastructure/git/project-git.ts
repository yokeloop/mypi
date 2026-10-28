import { spawnSync } from 'node:child_process';

export interface ProjectWorktree { path: string; branch: string | null; prunable: boolean }

const kept = new Set(['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'GIT_ASKPASS']);

export function projectGit(clone: string) {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') || kept.has(key))),
    GIT_TERMINAL_PROMPT: '0' };
  function git(args: string[], timeout: number, allowedStatus?: number): { status: number; stdout: string } {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', clone, ...args],
      { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, env });
    if (result.error || (result.status !== 0 && result.status !== allowedStatus)) {
      throw new Error(result.error?.message || result.stderr.trim() || 'Git failed');
    }
    return { status: result.status!, stdout: result.stdout };
  }
  function hasRef(ref: string): boolean {
    return git(['rev-parse', '--verify', '--quiet', ref + '^{commit}'], 10_000, 1).status === 0;
  }
  function checkedOut(): string | null {
    const result = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], 10_000, 1);
    return result.status === 0 ? result.stdout.trim() : null;
  }
  return {
    worktrees(): ProjectWorktree[] {
      return git(['worktree', 'list', '--porcelain'], 10_000).stdout.split('\n\n').filter(block => block.trim() !== '').map(block => {
        const entry: ProjectWorktree = { path: '', branch: null, prunable: false };
        for (const line of block.split('\n')) {
          if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length);
          else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length);
          else if (line.startsWith('prunable')) entry.prunable = true;
        }
        return entry;
      });
    },
    hasRef,
    checkedOut,
    defaultBranch(): string | null {
      const result = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], 10_000, 1);
      const name = result.stdout.trim();
      if (result.status === 0 && name.startsWith('origin/')) return name.slice('origin/'.length);
      return hasRef('refs/remotes/origin/main') ? 'main' : null;
    },
    fetch(): void { git(['fetch', '--quiet', 'origin'], 60_000); },
    updateBranch(branch: string): void {
      if (checkedOut() === branch) git(['merge', '--ff-only', '--quiet', 'origin/' + branch], 60_000);
      else git(['fetch', '--quiet', 'origin', branch + ':' + branch], 60_000);
    },
    addWorktree(path: string, branch: string, start: { existing: true } | { from: string } | { track: string }): void {
      if ('existing' in start) git(['worktree', 'add', '--quiet', path, branch], 60_000);
      else if ('track' in start) git(['worktree', 'add', '--quiet', '--track', '-b', branch, path, start.track], 60_000);
      else git(['worktree', 'add', '--quiet', '-b', branch, path, start.from], 60_000);
    },
  };
}
