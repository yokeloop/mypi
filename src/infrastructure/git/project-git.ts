import { spawn, spawnSync } from 'node:child_process';
import { CancelledError } from '../../shared/errors.js';

export interface ProjectWorktree { path: string; branch: string | null; prunable: boolean }

const kept = new Set(['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'GIT_ASKPASS']);

export const CLONE_IDLE_TIMEOUT_MS = 300_000;
export const CLONE_HEARTBEAT_MS = 10_000;
export const CLONE_KILL_GRACE_MS = 5_000;

export interface CloneOptions { signal?: AbortSignal; onLine?: (line: string) => void; idleTimeoutMs?: number }

function gitEnv() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') || kept.has(key))),
    GIT_TERMINAL_PROMPT: '0' };
}

function run(args: string[], timeout: number, action: string): void {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, env: gitEnv() });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') throw new Error(action + ' timed out after ' + timeout / 1000 + ' s');
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || action + ' failed');
}

export function cloneRepository(repository: string, target: string, options: CloneOptions = {}): Promise<void> {
  const { signal, onLine } = options;
  if (signal?.aborted) return Promise.reject(new CancelledError('git clone cancelled'));
  const idleMs = options.idleTimeoutMs ?? CLONE_IDLE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.sshCommand=ssh -o BatchMode=yes',
      'clone', '--progress', '--', repository, target], { env: gitEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
    const lines: string[] = [];
    let last: string | undefined;
    let pending = '';
    let failure: Error | undefined;
    let grace: NodeJS.Timeout | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      grace = setTimeout(() => child.kill('SIGKILL'), CLONE_KILL_GRACE_MS);
    };
    const arm = () => setTimeout(() => stop(new Error('git clone made no progress for ' + idleMs / 1000 + ' s and was stopped')), idleMs);
    let idle = arm();
    const heartbeat = setInterval(() => { if (last !== undefined) onLine?.(last); }, CLONE_HEARTBEAT_MS);
    const onAbort = () => stop(new CancelledError('git clone cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });
    const take = (piece: string) => {
      const line = piece.trim().replace(/\s+/g, ' ').replace(/^remote: /, '');
      if (line === '') return;
      clearTimeout(idle);
      idle = arm();
      last = line;
      lines.push(line);
      if (lines.length > 20) lines.shift();
      onLine?.(line);
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const pieces = (pending + chunk).split(/[\r\n]+/);
      pending = pieces.pop()!;
      pieces.forEach(take);
    });
    const settle = () => {
      clearTimeout(idle);
      clearInterval(heartbeat);
      clearTimeout(grace);
      signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', error => {
      settle();
      reject(new Error(error.message));
    });
    child.on('close', code => {
      take(pending);
      pending = '';
      settle();
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else {
        const reported = lines.filter(line => line.startsWith('fatal:') || line.startsWith('error:'));
        reject(new Error(reported.length > 0 ? reported.join('; ') : lines.at(-1) ?? 'git clone exited with code ' + code));
      }
    });
  });
}

export function initRepository(target: string): void {
  run(['-c', 'core.hooksPath=/dev/null', 'init', '--quiet', '--initial-branch=main', '--', target], 10_000, 'git init');
  run(['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', target, '-c', 'user.name=mypi',
    '-c', 'user.email=mypi@localhost', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Initial empty commit'],
  10_000, 'git commit');
}

export function projectGit(clone: string) {
  const env = gitEnv();
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
    topLevel(): string | null {
      const result = git(['rev-parse', '--show-toplevel'], 10_000, 128);
      return result.status === 0 ? result.stdout.trim() : null;
    },
    originUrl(): string | null {
      const result = git(['config', '--get', 'remote.origin.url'], 10_000, 1);
      return result.status === 0 ? result.stdout.trim() : null;
    },
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
