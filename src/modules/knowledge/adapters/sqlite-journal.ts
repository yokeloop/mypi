import type { Database } from 'better-sqlite3';
import { entryValue } from '../model.js';
import type { Entry } from '../model.js';
import type { JournalStore } from '../ports.js';

export interface FileFingerprint { path: string; sha256: string; byteLength: number; registeredAt: string }
export interface JournalImport { path: string; sha256: string; byteLength: number; importedAt: string }

function digest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid SHA-256 digest');
}

export function sqliteJournalStore(db: Database): JournalStore & {
  importEntry(path: string, line: number, entry: Entry): void;
  journalImport(path: string): JournalImport | undefined;
  journalImports(): JournalImport[];
  recordJournalImport(input: JournalImport): void;
  fingerprint(path: string): FileFingerprint | undefined;
  saveFingerprint(input: FileFingerprint): void;
  relocateFiles(from: string, to: string): { fingerprints: number; artifacts: number };
} {
  const assertWritable = () => { if (db.readonly) throw new Error('Cannot mutate a readonly journal database'); };
  const insert = db.prepare(`INSERT INTO knowledge_journal(at,scope_type,scope_key,event_type,text,artifacts_json,import_path,import_line)
    VALUES (@at,@scopeType,@scopeKey,@eventType,@text,@artifactsJson,@importPath,@importLine)`);
  function write(entry: Entry, importPath: string | null, importLine: number | null): void {
    const valid = entryValue(entry);
    insert.run({ at: valid.at, scopeType: valid.scope.type, scopeKey: valid.scope.type === 'global' ? null : valid.scope.key,
      eventType: valid.event_type, text: valid.text, artifactsJson: valid.artifacts ? JSON.stringify(valid.artifacts) : null,
      importPath, importLine });
  }
  function decode(raw: unknown): Entry {
    const row = raw as { at: string; scopeType: Entry['scope']['type']; scopeKey: string | null; eventType: Entry['event_type']; text: string; artifactsJson: string | null };
    const scope = row.scopeType === 'global' ? { type: 'global' as const } : { type: row.scopeType, key: row.scopeKey! };
    return entryValue({ at: row.at, scope, event_type: row.eventType, text: row.text,
      ...(row.artifactsJson === null ? {} : { artifacts: JSON.parse(row.artifactsJson) }) });
  }
  return {
    append(entry) { assertWritable(); write(entry, null, null); return String((db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id); },
    *entries(fromMonth, toMonth) {
      const rows = db.prepare(`SELECT at,scope_type AS scopeType,scope_key AS scopeKey,event_type AS eventType,text,artifacts_json AS artifactsJson
        FROM knowledge_journal WHERE (? IS NULL OR substr(at,1,7) >= ?) AND (? IS NULL OR substr(at,1,7) <= ?) ORDER BY at,id`)
        .iterate(fromMonth ?? null, fromMonth ?? null, toMonth ?? null, toMonth ?? null);
      for (const raw of rows) yield decode(raw);
    },
    importEntry(path, line, entry) { assertWritable(); if (!path || !Number.isSafeInteger(line) || line < 1) throw new Error('Invalid journal import location'); write(entry, path, line); },
    journalImport(path) {
      const row = db.prepare('SELECT path,sha256,byte_length AS byteLength,imported_at AS importedAt FROM knowledge_journal_imports WHERE path=?').get(path) as JournalImport | undefined;
      return row;
    },
    journalImports() {
      return db.prepare('SELECT path,sha256,byte_length AS byteLength,imported_at AS importedAt FROM knowledge_journal_imports ORDER BY path').all() as JournalImport[];
    },
    recordJournalImport(input) {
      assertWritable(); digest(input.sha256);
      if (!input.path || !Number.isSafeInteger(input.byteLength) || input.byteLength < 0) throw new Error('Invalid journal import metadata');
      const existing = this.journalImport(input.path);
      if (existing) {
        if (existing.sha256 !== input.sha256 || existing.byteLength !== input.byteLength) throw new Error('Legacy journal changed after import');
        return;
      }
      db.prepare('INSERT INTO knowledge_journal_imports(path,sha256,byte_length,imported_at) VALUES (?,?,?,?)')
        .run(input.path, input.sha256, input.byteLength, input.importedAt);
    },
    fingerprint(path) {
      return db.prepare('SELECT path,sha256,byte_length AS byteLength,registered_at AS registeredAt FROM knowledge_file_fingerprints WHERE path=?').get(path) as FileFingerprint | undefined;
    },
    saveFingerprint(input) {
      assertWritable(); digest(input.sha256);
      if (!input.path || !Number.isSafeInteger(input.byteLength) || input.byteLength < 0) throw new Error('Invalid file fingerprint metadata');
      db.prepare(`INSERT INTO knowledge_file_fingerprints(path,sha256,byte_length,registered_at) VALUES (?,?,?,?)
        ON CONFLICT(path) DO NOTHING`).run(input.path, input.sha256, input.byteLength, input.registeredAt);
    },
    relocateFiles(from, to) {
      assertWritable();
      const fingerprints = db.prepare(`UPDATE knowledge_file_fingerprints SET path = ? || substr(path, length(?) + 1)
        WHERE substr(path, 1, length(?) + 1) = ? || '/'`).run(to, from, from, from).changes;
      const rows = db.prepare(`SELECT id, artifacts_json AS artifactsJson FROM knowledge_journal
        WHERE artifacts_json IS NOT NULL AND instr(artifacts_json, '"' || ? || '/') > 0`).all(from) as { id: number; artifactsJson: string }[];
      let artifacts = 0;
      for (const row of rows) {
        const paths = JSON.parse(row.artifactsJson) as string[];
        const mapped = paths.map(p => p.startsWith(from + '/') ? to + p.slice(from.length) : p);
        if (mapped.some((p, i) => p !== paths[i])) {
          db.prepare('UPDATE knowledge_journal SET artifacts_json = ? WHERE id = ?').run(JSON.stringify(mapped), row.id);
          artifacts++;
        }
      }
      return { fingerprints, artifacts };
    },
  };
}
