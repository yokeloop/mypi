import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalDirectory } from '../filesystem/paths.js';
import { InputError } from '../../shared/errors.js';

const unavailable = (): never => { throw new InputError('Repository evidence unavailable'); };
const branchName = (ref: string): string => {
  if (!ref.startsWith('refs/heads/') || ref.length === 11) unavailable();
  return ref.slice(11);
};
function directory(path: string): string {
  // rev-parse has line-delimited output; ambiguous multiline paths fail closed.
  if (/[\r\n\0]/.test(path)) unavailable();
  const root = canonicalDirectory(path);
  if (/[\r\n\0]/.test(root)) unavailable();
  return root;
}

/**
 * Fixed local read-only Git commands only. No ambient Git/loader variables, global
 * config, hooks, filters, lazy fetch, pager or shell. Local metadata is still trusted
 * input to Git, not sandboxed hostile code. Linux's installed /usr/bin/git is trusted.
 * Each invocation has a 3s hard kill and 1MiB output bound; commands never mutate refs,
 * indexes or files. Returned plain evidence deliberately has no module dependency.
 */
export function repositoryIdentityReader() {
  function git(root: string, args: readonly string[], detachedAllowed = false): string | null {
    const result = spawnSync('/usr/bin/git', ['--no-pager', '--no-optional-locks',
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false', '-c', 'protocol.allow=never',
      '-C', root, ...args], {
      encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: '/dev/null', XDG_CONFIG_HOME: '/dev/null', LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (detachedAllowed && !result.error && result.status === 1) return null;
    if (result.error || result.status !== 0 || !result.stdout) unavailable();
    return result.stdout;
  }
  function inspect(input: string) {
    try {
      const root = directory(input);
      const output = git(root, ['rev-parse', '--show-toplevel', '--absolute-git-dir',
        '--path-format=absolute', '--git-common-dir', '--is-bare-repository'])!;
      const fields = output.split('\n');
      if (fields.length !== 5 || fields[4] !== '' || !['true', 'false'].includes(fields[3]!)) unavailable();
      if (directory(fields[0]!) !== root) unavailable(); // A subdirectory is not a root grant.
      const gitDir = directory(fields[1]!), commonDir = directory(fields[2]!);
      const branchOutput = git(root, ['symbolic-ref', '--quiet', 'HEAD'], true);
      const branch = branchOutput === null ? null : branchName(branchOutput.replace(/\n$/, ''));
      const head = git(root, ['rev-parse', '--verify', 'HEAD'])!.replace(/\n$/, '');
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) unavailable();
      const metadata = join(root, '.git');
      const primary = lstatSync(metadata).isDirectory() && directory(metadata) === gitDir && gitDir === commonDir;
      return Object.freeze({ root, gitDir, commonDir, primary, bare: fields[3] === 'true', branch, head });
    } catch { return unavailable(); }
  }
  function worktrees(input: string) {
    try {
      const output = git(directory(input), ['worktree', 'list', '--porcelain', '-z'])!;
      if (!output.endsWith('\0\0')) unavailable();
      const records = output.slice(0, -2).split('\0\0');
      if (records.length > 1024) unavailable();
      return Object.freeze(records.map(record => {
        const fields = record.split('\0');
        const path = fields.shift();
        if (!path?.startsWith('worktree ')) unavailable();
        const values = new Map<string, string>();
        for (const field of fields) {
          const space = field.indexOf(' ');
          const key = space < 0 ? field : field.slice(0, space);
          if (!['HEAD', 'branch', 'bare', 'detached', 'locked', 'prunable'].includes(key) || values.has(key)) unavailable();
          values.set(key, space < 0 ? '' : field.slice(space + 1));
        }
        let root: string | null;
        try { root = directory(path!.slice(9)); } catch { root = null; }
        const ref = values.get('branch');
        return Object.freeze({ root, branch: ref === undefined ? null : branchName(ref), head: values.get('HEAD') ?? null,
          bare: values.has('bare'), detached: values.has('detached'), locked: values.has('locked'), prunable: values.has('prunable') });
      }));
    } catch { return unavailable(); }
  }
  return { inspect, worktrees };
}
