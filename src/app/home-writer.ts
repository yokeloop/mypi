import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { acquireHomeLock } from '../infrastructure/filesystem/home-lock.js';
import { homePending } from '../infrastructure/filesystem/home-pending.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { contextGit } from '../infrastructure/git/context-git.js';
import { PartialError } from '../shared/context.js';
import { InputError } from '../shared/errors.js';
import type { HomeDeclaration, HomePending, HomeRecovery, HomeStatus, HomeWriteScope } from '../shared/home-writer.js';
export type { HomeDeclaration, HomePending, HomeStatus, HomeWriteScope } from '../shared/home-writer.js';

/** Coordinated entrypoint; raw workspace/file/domain/Git APIs remain maintenance bypasses. */
export function createHomeWriter(root: string) {
  function locked<T>(work: (home: string, git: ReturnType<typeof contextGit>, marker: ReturnType<typeof homePending>, descriptor: number) => T): T {
    const home = realpathSync(root), lock = acquireHomeLock(home);
    try {
      const git = contextGit(home, undefined, lock.descriptor);
      git.inspectRepository();
      return work(home, git, homePending(home), lock.descriptor);
    } finally { lock.close(); }
  }
  function observe(git: ReturnType<typeof contextGit>, pending: HomePending | null): HomeStatus {
    let head: string | null = null, remoteHead: string | null = null, remoteOutcome: HomeStatus['remoteOutcome'] = 'unknown', clean = false;
    try { head = git.head() ?? null; } catch { /* Report unavailable observation, not success. */ }
    try {
      const publication = git.publication();
      if (!pending || publication.destinationId === pending.destinationId) {
        remoteHead = publication.observe();
        remoteOutcome = remoteHead === null ? 'missing' : remoteHead === head ? 'matches-local' : 'different';
      }
    } catch { /* Credentials and transport stderr are never returned. */ }
    try { clean = git.writerState().dirty.length === 0; } catch { /* Invalid local setup needs attention. */ }
    return { head, pending, remoteHead, remoteOutcome, needsAttention: pending !== null || !clean || remoteOutcome !== 'matches-local' };
  }
  function recovery(git: ReturnType<typeof contextGit>, pending: HomePending): HomeRecovery {
    return { ...observe(git, pending), pending, needsAttention: true };
  }
  return {
    run<T>(operation: string, work: (scope: HomeWriteScope) => T): T {
      return locked((home, git, marker, descriptor) => {
        const prior = marker.read();
        if (prior) throw new PartialError('Pending home operation requires explicit inspection; do not replay the write', [],
          ['inspect pending home operation'], prior.paths, undefined, recovery(git, prior));
        const initial = git.writerState(), publication = git.publication(), remoteBefore = publication.observe();
        if (remoteBefore !== initial.head) throw new InputError('Home main must already match the configured origin/main; reconcile explicitly');
        if (initial.dirty.some(entry => entry.index !== ' ' && entry.index !== '?')) throw new InputError('Staged home changes require explicit reconciliation');
        const files = contextFiles(home), declared = new Map<string, HomeDeclaration>();
        let pending: HomePending | null = null, databaseSaved = false, requestId: number | undefined;
        function preimage(path: string): string | null {
          let fd: number;
          try { fd = openSync(files.path(path), constants.O_RDONLY | constants.O_NOFOLLOW); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
          try {
            const stat = fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1) throw new InputError('Declared home targets must be regular files');
            const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
            let count: number;
            while ((count = readSync(fd, buffer, 0, buffer.length, null)) !== 0) hash.update(buffer.subarray(0, count));
            return hash.digest('hex');
          } finally { closeSync(fd); }
        }
        function admit() {
          const current = git.writerState();
          if (current.head !== initial.head) throw new InputError('Home HEAD changed before effects');
          if (current.dirty.some(entry => (entry.index !== ' ' && entry.index !== '?') || !declared.get(entry.path)?.adopt)) {
            throw new InputError('Unexplained home changes require explicit reconciliation');
          }
          for (const entry of declared.values()) if (preimage(entry.path) !== entry.expected) throw new InputError('Home preimage changed; re-read before writing');
        }
        const scope: HomeWriteScope = {
          descriptor, preimage,
          declare(paths) {
            if (pending) throw new InputError('Declare all operation paths before effects');
            git.declared(paths.map(entry => entry.path));
            for (const entry of paths) {
              if (entry.expected !== null && !/^[a-f0-9]{64}$/.test(entry.expected)) throw new InputError('Expected home SHA256 preimage required');
              if (preimage(entry.path) !== entry.expected) throw new InputError('Home preimage changed; re-read before writing');
              const previous = declared.get(entry.path);
              if (previous && (previous.expected !== entry.expected || previous.adopt !== entry.adopt)) throw new InputError('Conflicting home path declaration');
              declared.set(entry.path, { ...entry });
            }
          },
          beforeEffect() {
            if (pending) return;
            admit();
            const next: HomePending = { id: randomUUID(), operation, paths: [...declared.keys()], beforeHead: initial.head,
              phase: 'mutating', destinationId: publication.destinationId };
            marker.write(next, true); pending = next;
          },
          databaseSaved(id) { databaseSaved = true; requestId = id; },
          committed(commit) {
            if (!pending) throw new InputError('Home commit without declared effects');
            const next: HomePending = { ...pending, phase: 'committed', commit };
            marker.write(next); pending = next;
          },
        };
        try {
          const result = work(scope);
          if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('HomeWriter requires a synchronous operation');
          // No-op validation/reads must not leave an invented pending operation.
          if (!pending) { admit(); return result; }
          const record = pending as HomePending;
          const current = git.writerState();
          if (record.phase === 'mutating' && !databaseSaved && current.head === initial.head
            && [...declared.values()].every(entry => preimage(entry.path) === entry.expected)) {
            marker.clear(); return result;
          }
          if (!record.commit || current.head !== record.commit || current.dirty.length
            || !git.exactOperation(initial.head, record.commit, record.paths)) throw new Error('Home operation did not produce one clean exact commit');
          const publishing: HomePending = { ...record, phase: 'publishing' };
          marker.write(publishing); pending = publishing;
          try { publication.publish(record.commit, remoteBefore); }
          catch {
            throw new PartialError('Home mutation saved; publication is not confirmed. Inspect pending state without replay',
              [...(databaseSaved ? ['database'] : []), 'context', 'git'], ['confirmed home publication'], record.paths, requestId);
          }
          marker.clear();
          return result;
        } catch (error) {
          if (!pending) throw error;
          const record = pending as HomePending;
          // Only known synchronous validation/transaction refusals qualify. Generic
          // errors and PartialErrors may hide effects even when saved[] is empty.
          if (error instanceof InputError && !databaseSaved && record.phase === 'mutating'
            && git.head() === initial.head && [...declared.values()].every(entry => preimage(entry.path) === entry.expected)) {
            marker.clear(); throw error;
          }
          const partial = error instanceof PartialError ? error : new PartialError(String(error), databaseSaved ? ['database'] : [],
            ['inspect home operation'], record.paths, requestId);
          partial.home = recovery(git, record);
          throw partial;
        }
      });
    },
    status(): HomeStatus { return locked((_home, git, marker) => observe(git, marker.read())); },
    reconcile(): HomeStatus & { reconciled: boolean } {
      return locked((_home, git, marker) => {
        const pending = marker.read(), status = observe(git, pending);
        let reconciled = false;
        if (pending?.phase === 'publishing' && pending.commit === status.head && status.remoteOutcome === 'matches-local') {
          try {
            if (!git.writerState().dirty.length && git.exactOperation(pending.beforeHead, pending.commit, pending.paths)) {
              marker.clear(); reconciled = true;
            }
          } catch { /* Ambiguous state stays pending for explicit operator disposition. */ }
        }
        return reconciled ? { ...status, pending: null, needsAttention: false, reconciled } : { ...status, reconciled };
      });
    },
  };
}
