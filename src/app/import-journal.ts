import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ContextFiles, ContextHistory } from '../shared/context.js';
import type { Entry, FileFingerprint } from '../modules/knowledge/public.js';
import type { Scope } from '../shared/scope.js';
import type { sqliteJournalStore } from '../modules/knowledge/public.js';
import { fileFingerprint, matchesFingerprint } from './file-fingerprints.js';

// Explicit cutover only: validate all input before committing any imported rows.
export function importLegacyJournal(files: ContextFiles & { path(path: string): string },
  git: ContextHistory, store: ReturnType<typeof sqliteJournalStore>, serialize: <T>(fn: () => T) => T,
  clock: () => string, sourcePaths: string[], resolve: (scope: Scope) => void): { imported: number } {
  const names = files.list('journal');
  const sources: { path: string; bytes: Buffer; sha256: string; entries: Entry[] }[] = [];
  const paths = new Set<string>();
  for (const name of names) {
    if (!/^\d{4}-(0[1-9]|1[0-2])\.jsonl$/.test(name)) throw new Error('Unexpected journal file: ' + name);
    const path = 'journal/' + name, bytes = readFileSync(files.path(path));
    const existing = store.journalImport(path), sha256 = createHash('sha256').update(bytes).digest('hex');
    if (existing && (existing.sha256 !== sha256 || existing.byteLength !== bytes.length)) throw new Error('Legacy journal changed after import: ' + path);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text && !text.endsWith('\n')) throw new Error(path + ': incomplete final line');
    const entries: Entry[] = [];
    for (const [index, line] of (text ? text.slice(0, -1).split('\n') : []).entries()) {
      try {
        const entry = JSON.parse(line) as Entry;
        if (!entry.at.startsWith(name.slice(0, 7) + '-')) throw new Error('Wrong rotation month');
        resolve(entry.scope);
        if (entry.artifacts !== undefined && (!Array.isArray(entry.artifacts)
          || entry.artifacts.some(path => typeof path !== 'string'))) throw new Error('Invalid artifact references');
        entries.push(entry);
        for (const artifact of entry.artifacts ?? []) paths.add(artifact);
      } catch (error) { throw new Error(path + ':' + (index + 1) + ': ' + String(error)); }
    }
    sources.push({ path, bytes, sha256, entries });
  }
  // Check committed preimages before accepting historical fingerprints. No changed file is blessed.
  git.validate(names.map(name => 'journal/' + name));
  const registered = [...new Set([...paths, ...sourcePaths])];
  if (registered.length) { git.clean(registered); git.validate(registered); }
  const fingerprints: FileFingerprint[] = [...new Set([...paths, ...sourcePaths])].map(path => fileFingerprint(files, path, clock()));
  return serialize(() => {
    const present = new Set(sources.map(source => source.path));
    for (const imported of store.journalImports()) {
      if (!present.has(imported.path)) throw new Error('Imported legacy journal missing: ' + imported.path);
    }
    let imported = 0;
    for (const source of sources) {
      if (store.journalImport(source.path)) continue;
      source.entries.forEach((entry, index) => {
        try { store.importEntry(source.path, index + 1, entry); imported++; }
        catch (error) { throw new Error(source.path + ':' + (index + 1) + ': ' + String(error)); }
      });
      store.recordJournalImport({ path: source.path, sha256: source.sha256, byteLength: source.bytes.length, importedAt: clock() });
    }
    for (const fingerprint of fingerprints) {
      const existing = store.fingerprint(fingerprint.path);
      if (existing) matchesFingerprint(existing, fingerprint);
      else store.saveFingerprint(fingerprint);
    }
    return { imported };
  });
}
