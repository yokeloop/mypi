import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Registry, RegistryRecord } from '../ports.js';
const fileName = /^(global|[A-Z]+|[A-Z]+-[1-9][0-9]*)(~[1-9][0-9]*)?\.json$/;
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
function exists(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) { if (missing(error)) return false; throw error; }
}
function safe(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) {
    throw new Error('Unsafe session registry directory: ' + path);
  }
}
function unlink(path: string): void {
  try { unlinkSync(path); } catch (error) { if (!missing(error)) throw error; }
}
const text = (value: unknown) => typeof value === 'string';
const nullable = (value: unknown) => value === null || typeof value === 'string';
function shaped(value: unknown, key: string, pid: number | undefined): value is RegistryRecord {
  const r = value as Record<string, unknown>;
  return typeof value === 'object' && value !== null && !Array.isArray(value) && r['key'] === key
    && (r['agent'] === 'claude' || r['agent'] === 'pi') && text(r['nativeId']) && Number.isSafeInteger(r['pid']) && (r['pid'] as number) > 0
    && text(r['start']) && nullable(r['name']) && nullable(r['socket']) && nullable(r['permissionMode']) && text(r['registeredAt'])
    && (pid === undefined ? r['displacedAt'] === undefined : text(r['displacedAt']) && r['pid'] === pid);
}
export function fsRegistry(dir: string, proc = '/proc'): Registry {
  const parent = dirname(dir);
  const file = (record: RegistryRecord) => join(dir, record.key + (record.displacedAt === undefined ? '' : '~' + record.pid) + '.json');
  function prepare(): void {
    for (const path of [parent, dir]) {
      try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      safe(path);
    }
  }
  function save(record: RegistryRecord): void {
    prepare();
    const tmp = join(dir, '.' + randomUUID() + '.tmp');
    const fd = openSync(tmp, 'wx', 0o600);
    try { writeSync(fd, JSON.stringify(record) + '\n'); } finally { closeSync(fd); }
    renameSync(tmp, file(record));
  }
  function start(pid: number): string | undefined {
    let stat: string;
    try { stat = readFileSync(join(proc, String(pid), 'stat'), 'utf8'); } catch (error) {
      if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined;
      throw error;
    }
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  }
  return {
    start,
    permissionMode(pid) {
      let args: string[];
      try { args = readFileSync(join(proc, String(pid), 'cmdline'), 'utf8').split('\0'); } catch { return null; }
      for (const [i, arg] of args.entries()) {
        if (arg === '--permission-mode') return args[i + 1] || null;
        if (arg.startsWith('--permission-mode=')) return arg.slice('--permission-mode='.length) || null;
        if (arg === '--dangerously-skip-permissions') return 'bypassPermissions';
      }
      return null;
    },
    live() {
      if (!exists(parent) || !exists(dir)) return [];
      safe(parent); safe(dir);
      const records: RegistryRecord[] = [];
      for (const name of readdirSync(dir).sort()) {
        const match = fileName.exec(name);
        if (!match) continue;
        const path = join(dir, name);
        let stat;
        try { stat = lstatSync(path); } catch (error) { if (missing(error)) continue; throw error; }
        if (!stat.isFile() || stat.uid !== process.getuid!()) continue;
        let record: unknown;
        try { record = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
          if (missing(error)) continue;
          record = undefined;
        }
        if (!shaped(record, match[1]!, match[2] === undefined ? undefined : Number(match[2].slice(1)))) { unlink(path); continue; }
        if (start(record.pid) !== record.start) { unlink(path); continue; }
        records.push(record);
      }
      return records;
    },
    write: save,
    displace(record, at) {
      const next = { ...record, displacedAt: at };
      save(next);
      unlink(file(record));
      return next;
    },
    remove(record) { unlink(file(record)); },
  };
}
