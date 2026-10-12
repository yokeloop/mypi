import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface BrowseEntry { name: string; path: string; kind: 'directory' | 'file' | 'link' | 'other'; targetKind?: 'directory' | 'file' | 'other'; error?: string }
export interface BrowseResult { path: string; entries: BrowseEntry[]; total: number; nextOffset?: number; error?: string }
/** A single directory only; pagination never silently drops entries. */
export function browseDirectory(path: string, query = '', offset = 0, limit = 80): BrowseResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    return { path, entries: [], total: 0, error: 'Invalid directory page' };
  }
  try {
    const directory = realpathSync(path);
    if (!statSync(directory).isDirectory()) return { path, entries: [], total: 0, error: 'Not a directory: ' + path };
    const names = readdirSync(directory).filter(name => name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => a.localeCompare(b));
    const entries = names.slice(offset, offset + limit).map(name => {
      const child = join(directory, name);
      try {
        const stat = lstatSync(child);
        if (stat.isSymbolicLink()) {
          try { const target = statSync(child); return { name, path: child, kind: 'link' as const,
            targetKind: target.isDirectory() ? 'directory' as const : target.isFile() ? 'file' as const : 'other' as const }; }
          catch (error) { return { name, path: child, kind: 'link' as const, error: String(error) }; }
        }
        return { name, path: child, kind: stat.isDirectory() ? 'directory' as const : stat.isFile() ? 'file' as const : 'other' as const };
      } catch (error) { return { name, path: child, kind: 'other' as const, error: String(error) }; }
    });
    return { path: directory, entries, total: names.length, ...(offset + limit < names.length ? { nextOffset: offset + limit } : {}) };
  } catch (error) { return { path, entries: [], total: 0, error: String(error) }; }
}
