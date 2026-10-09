import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { InputError } from '../../shared/errors.js';
import { PartialError } from '../../shared/context.js';

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
  function status() {
    noFilters();
    return git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--ignore-submodules=all'])
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
  return {
    head, status, operationState,
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
        throw new InputError('Prepare target must be outside existing worktree roots');
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
    commit(paths: string[], message: string) {
      noFilters();
      if (operationState().length || git(['ls-files', '--unmerged', '-z'])) throw new InputError('Resolve existing Git operation/conflicts before committing');
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
        const staged = git(['diff', '--cached', '--name-only', '-z', '--', path]);
        if (staged && git(['diff', '--name-only', '-z', '--', path])) throw new InputError('Declared staged content differs from working file; reconcile explicitly');
        if (staged && !indexed.has(path) && !missing) throw new InputError('Declared staged deletion has a working replacement; reconcile explicitly');
      }
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
      branch(name);
      const configured = git(['remote']).trim().split('\n');
      if (!configured.includes(remote)) throw new InputError('Unknown configured remote');
      if (git(['config', '--get-regexp', '^url\\..*\\.(pushinsteadof|insteadof)$'], true)
        || git(['config', '--bool', '--get', 'remote.' + remote + '.mirror'], true).trim() === 'true') throw new InputError('Ambiguous/rewrite/mirror remote configuration');
      const urls = git(['remote', 'get-url', '--push', '--all', remote]).trim().split('\n');
      if (urls.length !== 1 || !urls[0] || /[\r\0]/.test(urls[0])) throw new InputError('Single configured push destination required');
      if (configured.includes(urls[0])) throw new InputError('Push destination is ambiguous with a configured remote name');
      const url = urls[0], target = head(), ref = 'refs/heads/' + name;
      function observe(): string | null {
        const output = git(['ls-remote', '--refs', '--', url!, ref]).trim();
        if (!output) return null;
        const rows = output.split('\n');
        const [oid, found] = rows[0]!.split('\t');
        if (rows.length !== 1 || found !== ref || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid!)) throw new InputError('Remote ref observation unavailable');
        return oid!;
      }
      const before = observe(); // Unreadable destination: no push has been attempted.
      if (before === target) return { status: 'ok' as const, head: target, remote, ref, remoteHead: before, push: 'not-needed' as const };
      const pushed = run(['-c', 'push.followTags=false', 'push', '--porcelain', '--no-force', '--no-follow-tags', '--recurse-submodules=no', '--', url, target + ':' + ref]);
      const outcome = pushed.error || pushed.status !== 0 ? 'failed-or-uncertain' : 'exited-zero';
      let after: string | null;
      try { after = observe(); } catch {
        throw new PartialError('Push attempted; destination unreadable. Inspect the remote ref before any later action',
          ['head=' + target, 'remote=' + remote, 'ref=' + ref, 'before=' + before, 'push=' + outcome], ['confirmed remote ref'], []);
      }
      if (after !== target) throw new PartialError('Push target not confirmed. Inspect the remote ref before any later action',
        ['head=' + target, 'remote=' + remote, 'ref=' + ref, 'before=' + before, 'remoteHead=' + after, 'push=' + outcome], ['confirmed remote ref'], []);
      return { status: 'ok' as const, head: target, remote, ref, remoteHead: after, push: outcome };
    },
  };
}
