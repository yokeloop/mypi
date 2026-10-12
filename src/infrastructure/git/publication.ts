import { createHash } from 'node:crypto';
import type { SpawnSyncReturns } from 'node:child_process';
import { InputError } from '../../shared/errors.js';
import { PartialError } from '../../shared/context.js';

/** Pins one configured push destination; never exposes its potentially credential-bearing URL. */
export function gitPublication(run: (args: string[]) => SpawnSyncReturns<string>, name: string, remote: string) {
  function git(args: string[], missing = false): string {
    const result = run(args);
    if (missing && !result.error && result.status === 1) return '';
    if (result.error || result.status !== 0) throw new InputError('Git publication observation unavailable');
    return result.stdout;
  }
  const ref = 'refs/heads/' + name;
  git(['check-ref-format', ref]);
  const configured = git(['remote']).trim().split('\n');
  if (!configured.includes(remote)) throw new InputError('Unknown configured remote');
  if (git(['config', '--get-regexp', '^url\\..*\\.(pushinsteadof|insteadof)$'], true)
    || git(['config', '--bool', '--get', 'remote.' + remote + '.mirror'], true).trim() === 'true') throw new InputError('Ambiguous/rewrite/mirror remote configuration');
  const urls = git(['remote', 'get-url', '--push', '--all', remote]).trim().split('\n');
  if (urls.length !== 1 || !urls[0] || /[\r\0]/.test(urls[0])) throw new InputError('Single configured push destination required');
  if (configured.includes(urls[0])) throw new InputError('Push destination is ambiguous with a configured remote name');
  const url = urls[0], destinationId = createHash('sha256').update(url).digest('hex');
  function observe(): string | null {
    const output = git(['ls-remote', '--refs', '--', url, ref]).trim();
    if (!output) return null;
    const rows = output.split('\n');
    const [oid, found] = rows[0]!.split('\t');
    if (rows.length !== 1 || found !== ref || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid!)) throw new InputError('Remote ref observation unavailable');
    return oid!;
  }
  return { destinationId, observe,
    publish(target: string, before = observe()) {
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
