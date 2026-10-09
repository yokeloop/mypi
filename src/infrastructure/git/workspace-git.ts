import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { InputError } from '../../shared/errors.js';
import { PartialError } from '../../shared/context.js';
import { gitPublication } from './publication.js';

/** Explicit local Git helpers, not a shell interceptor or concurrent-writer lock. */
export function workspaceGit(root: string) {
  function run(args: string[], literalPathspecs = true) {
    return spawnSync('/usr/bin/git', ['--no-pager', ...(literalPathspecs ? ['--literal-pathspecs'] : []),
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false',
      '-c', 'submodule.recurse=false', '-C', root, ...args], {
      encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
        GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  function git(args: string[], missing = false): string {
    const result = run(args);
    if (missing && !result.error && result.status === 1) return '';
    // Git stderr may contain credential-bearing URLs. Never forward it.
    if (result.error || result.status !== 0) throw new InputError('Workspace Git operation failed: ' + args[0]);
    return result.stdout;
  }
  const head = () => git(['rev-parse', '--verify', 'HEAD']).trim();
  function noFilters(): void {
    if (git(['config', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], true)) {
      throw new InputError('Configured Git filters require ordinary Git, not workspace helpers');
    }
  }
  function status(read = git) {
    noFilters();
    return read(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--ignore-submodules=all'])
      .split('\0').filter(Boolean).map(entry => ({ index: entry[0]!, worktree: entry[1]!, path: entry.slice(3) }));
  }
  function observation(): string[] {
    const facts: string[] = [];
    try { facts.push('HEAD=' + head()); } catch { facts.push('HEAD unavailable'); }
    try { facts.push('status=' + JSON.stringify(status())); } catch { facts.push('status unavailable'); }
    return facts;
  }
  function branch(name: string) { git(['check-ref-format', 'refs/heads/' + name]); }
  function operationState(): string[] {
    return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_START', 'rebase-merge', 'rebase-apply', 'sequencer']
      .filter(name => existsSync(git(['rev-parse', '--path-format=absolute', '--git-path', name]).trim()));
  }
  function checkedContent() {
    function inventory(args: string[]): string {
      const result = run(args);
      // Exit zero can still omit unreadable directories. Never cache partial inventory
      // as checked content, or expose raw Git stderr in the diagnostic.
      if (result.error || result.status !== 0 || result.stderr) throw new InputError('Checked material unavailable: Git inventory observation failed');
      return result.stdout;
    }
    noFilters();
    if (operationState().length || inventory(['ls-files', '--unmerged', '-z'])) throw new InputError('Checked material unavailable: Git operation/conflicts');
    if (inventory(['ls-files', '-v', '-z']).split('\0').some(entry => /^[a-zS] /.test(entry))) {
      throw new InputError('Checked material unavailable: assume-unchanged or skip-worktree flags');
    }
    const tree = inventory(['ls-tree', '-r', '-z', 'HEAD']).split('\0').filter(Boolean);
    const index = inventory(['ls-files', '--stage', '-z']).split('\0').filter(Boolean);
    const committed = new Map<string, [string, string]>();
    const paths = new Set<string>();
    for (const entries of [tree, index]) for (const entry of entries) {
      const tab = entry.indexOf('\t'), fields = entry.slice(0, tab).split(' '), path = entry.slice(tab + 1);
      if (!['100644', '100755'].includes(fields[0]!)) throw new InputError('Checked material unavailable: only regular files supported');
      paths.add(path);
      if (entries === tree) committed.set(path, [fields[0]!, fields[2]!]);
    }
    const tracked = new Set(paths);
    for (const path of inventory(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) paths.add(path);
    if (paths.size > 10000) throw new InputError('Checked material unavailable: inventory exceeds 10000 paths');
    const format = git(['rev-parse', '--show-object-format']).trim();
    if (!['sha1', 'sha256'].includes(format)) throw new InputError('Checked material unavailable: object format');
    let bytes = 0;
    const working = new Map<string, [string, string]>();
    for (const path of [...paths].sort()) {
      const segments = path.split('/');
      if (path.includes('\ufffd') || segments.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new InputError('Checked material unavailable: path');
      try {
        for (let i = 1; i < segments.length; i++) {
          if (!lstatSync(join(root, ...segments.slice(0, i))).isDirectory()) throw new InputError('Checked material unavailable: non-directory component');
        }
        const file = join(root, path), stat = lstatSync(file);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || (bytes += stat.size) > 64 * 1024 * 1024) {
          throw new InputError('Checked material unavailable: file kind or byte limit');
        }
        const content = readFileSync(file);
        if (content.length !== stat.size) throw new InputError('Checked material changed during observation');
        const oid = createHash(format).update('blob ' + content.length + '\0').update(content).digest('hex');
        working.set(path, [stat.mode & 0o100 ? '100755' : '100644', oid]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !tracked.has(path)) throw error;
      }
    }
    const digest = (files: Map<string, [string, string]>) => createHash('sha256')
      .update(JSON.stringify([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest('hex');
    return { content: digest(working), headContent: digest(committed), tracked };
  }
  function cleanupInventory() {
    const inventory = { state: 'complete' as 'complete' | 'incomplete', tracked: [] as string[],
      changes: [] as ReturnType<typeof status>, untracked: [] as string[], ignored: [] as string[], issues: [] as string[] };
    const incomplete = (message: string) => {
      inventory.state = 'incomplete';
      if (!inventory.issues.includes(message)) inventory.issues.push(message);
    };
    function read(args: string[]): string {
      const result = run(args);
      if (result.error || result.status !== 0) throw new InputError('Cleanup inventory observation unavailable');
      // Git can omit unreadable directories with exit zero. Keep known stdout,
      // but never interpret a warning as complete or expose raw transport text.
      if (result.stderr) incomplete('Git reported an inventory warning; observation is incomplete');
      return result.stdout;
    }
    let count = 0;
    function bounded<T>(records: T[]): T[] {
      const remaining = Math.max(0, 10000 - count);
      count += records.length;
      if (count > 10000) incomplete('Inventory exceeds 10000 path records; lists are incomplete');
      return records.slice(0, remaining);
    }
    function paths(items: string[]): string[] {
      const distinct = [...new Set(items)];
      if (distinct.some(path => path.includes('\ufffd'))) incomplete('Path decoding unavailable');
      if (distinct.some(path => path.endsWith('/'))) incomplete('Directory or nested repository contents require separate inspection');
      return bounded(distinct).sort();
    }
    const tracked = new Set<string>();
    for (const args of [['ls-tree', '-r', '-z', 'HEAD'], ['ls-files', '--stage', '-z']]) {
      try {
        for (const entry of read(args).split('\0').filter(Boolean)) {
          const tab = entry.indexOf('\t');
          tracked.add(entry.slice(tab + 1));
          if (!/^(100644|100755) /.test(entry)) incomplete('Non-regular tracked material requires separate inspection');
        }
      } catch { incomplete('Tracked inventory unavailable: ' + args[0]); }
    }
    inventory.tracked = paths([...tracked]);
    try {
      const changes = status(read);
      inventory.changes = bounded(changes);
      if (changes.some(entry => entry.path.includes('\ufffd'))) incomplete('Path decoding unavailable');
    } catch { incomplete('Working/index status unavailable'); }
    for (const kind of ['untracked', 'ignored'] as const) {
      try { inventory[kind] = paths(read(['ls-files', '--others', ...(kind === 'ignored' ? ['--ignored'] : []), '--exclude-standard', '-z']).split('\0').filter(Boolean)); }
      catch { incomplete(kind + ' inventory unavailable'); }
    }
    try {
      if (read(['ls-files', '-v', '-z']).split('\0').some(entry => /^[a-zS] /.test(entry))) incomplete('Assume-unchanged or skip-worktree flags require separate inspection');
      if (read(['ls-files', '--unmerged', '-z'])) incomplete('Unmerged index requires separate inspection');
    } catch { incomplete('Index flags/conflicts unavailable'); }
    return inventory;
  }
  return {
    head, status, operationState, checkedContent, cleanupInventory,
    observePublication(name: string, remote: string) { return gitPublication(run, name, remote).observe(); },
    checkCachePath: () => git(['rev-parse', '--path-format=absolute', '--git-path', 'mypi-workspace-check.json']).trim(),
    prepare(target: string, name: string, startPoint: string, knownRoots: readonly (string | null)[]) {
      noFilters(); branch(name);
      if (startPoint.startsWith('refs/')) git(['check-ref-format', startPoint]);
      const start = git(['rev-parse', '--verify', startPoint + '^{commit}']).trim();
      const existing = run(['show-ref', '--verify', '--quiet', 'refs/heads/' + name]);
      if (existing.error || existing.status !== 1) {
        throw new InputError('Prepare requires an absent local branch');
      }
      const path = join(realpathSync(dirname(resolve(target))), resolve(target).split('/').at(-1)!);
      try { lstatSync(path); throw new InputError('Prepare requires an absent path'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (knownRoots.some(known => known !== null && (path === known || path.startsWith(known + '/') || known.startsWith(path + '/')))) {
        throw new InputError('Prepare target must be outside existing worktrees and protected Git metadata');
      }
      const result = run(['worktree', 'add', '--quiet', '--no-track', '-b', name, '--', path, start]);
      if (result.error || result.status !== 0) {
        const saved = ['targetExists=' + existsSync(path)];
        try { saved.push('branch=' + git(['rev-parse', '--verify', 'refs/heads/' + name]).trim()); } catch { saved.push('branch unavailable'); }
        try { saved.push('worktrees=' + git(['worktree', 'list', '--porcelain', '-z'])); } catch { saved.push('worktrees unavailable'); }
        throw new PartialError('Prepare failed after starting; inspect branch/path/worktrees before any later action', saved, ['confirmed prepare'], [path]);
      }
      return { status: 'ok' as const, worktreeRoot: path, branch: name, start, head: start };
    },
    commit(paths: string[], message: string, requireCurrentCheck: () => void) {
      function hasContentDiff(path: string, cached = false): boolean {
        // Numstat computes content differences without refreshing index metadata;
        // name-only/quiet can report stat-dirty but byte-identical working files.
        const result = run(['-c', 'diff.autoRefreshIndex=false', 'diff', '--numstat', '--no-ext-diff', '--no-textconv',
          ...(cached ? ['--cached'] : []), '--', path]);
        if (result.error || result.signal || result.status !== 0 || result.stderr) throw new InputError('Workspace Git content comparison unavailable');
        return result.stdout.length > 0; // Mode-only changes have a meaningful 0/0 record too.
      }
      noFilters();
      if (operationState().length || git(['ls-files', '--unmerged', '-z'])) throw new InputError('Resolve existing Git operation/conflicts before committing');
      // -v lowercases assume-unchanged entries; S marks skip-worktree. Neither
      // permits a reliable declared-file observation, and helpers must not clear them.
      if (git(['ls-files', '-v', '-z', '--', ...paths]).split('\0').some(entry => /^[a-zS] /.test(entry))) {
        throw new InputError('Declared paths have assume-unchanged or skip-worktree flags; reconcile explicitly');
      }
      // Check metadata/file kinds before status/diff/add can inspect working file contents.
      const indexed = new Map(git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map(entry => {
        const tab = entry.indexOf('\t'); return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')[0]!] as const;
      }));
      const committed = new Map(git(['ls-tree', '-r', '-z', 'HEAD']).split('\0').filter(Boolean).map(entry => {
        const tab = entry.indexOf('\t'); return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')[0]!] as const;
      }));
      for (const path of paths) {
        for (const mode of [indexed.get(path), committed.get(path)]) if (mode && !['100644', '100755'].includes(mode)) throw new InputError('Only regular workspace files supported');
        let missing = false;
        const segments = path.split('/');
        for (let i = 0; i < segments.length; i++) {
          try {
            const stat = lstatSync(join(root, ...segments.slice(0, i + 1)));
            if (stat.isSymbolicLink() || (i === segments.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new InputError('Only regular files without symlink components supported');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            missing = true; break;
          }
        }
        if (missing && !committed.has(path)) throw new InputError('Missing path is not a tracked file deletion');
        if (!indexed.has(path) && !committed.has(path)) {
          // check-ignore takes literal pathnames and rejects pathspec magic, including
          // the magic implied by --literal-pathspecs. Only documented exit 1 allows it.
          const ignored = run(['check-ignore', '--quiet', '--', './' + path], false);
          if (ignored.error || ignored.status !== 1) throw new InputError('Ignored or unavailable new file');
        }
        const staged = hasContentDiff(path, true);
        if (staged && hasContentDiff(path)) throw new InputError('Declared staged content differs from working file; reconcile explicitly');
        if (staged && !indexed.has(path) && !missing) throw new InputError('Declared staged deletion has a working replacement; reconcile explicitly');
      }
      requireCurrentCheck();
      const before = head();
      if (!status().some(entry => paths.includes(entry.path))) return { status: 'ok' as const, before, head: before, changed: false, paths };
      try {
        const toStage = paths.filter(path => indexed.has(path) || existsSync(join(root, path)));
        if (toStage.length) git(['add', '--', ...toStage]);
        git(['commit', '--quiet', '--only', '-m', message, '--', ...paths]);
        return { status: 'ok' as const, before, head: head(), changed: true, paths };
      } catch {
        throw new PartialError('Commit did not complete normally; declared index entries may have changed. Inspect HEAD/status before any later action',
          ['before=' + before, ...observation()], ['confirmed exact commit'], paths);
      }
    },
    publish(name: string, remote: string) {
      return gitPublication(run, name, remote).publish(head());
    },
  };
}
