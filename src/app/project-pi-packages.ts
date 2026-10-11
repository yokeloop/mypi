import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { InputError } from '../shared/errors.js';

type Entry = { source: string; extensions?: string[]; autoload?: boolean };
function settings(path: string, userHome: string): Entry[] {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')) as unknown; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new InputError(`Cannot inspect Pi package settings at ${path}; reconcile before opening a tab`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(`Invalid Pi settings at ${path}`);
  const packages = (value as Record<string, unknown>)['packages'];
  if (packages === undefined) return [];
  if (!Array.isArray(packages)) throw new InputError(`Invalid Pi packages at ${path}`);
  return packages.map(item => {
    const entry = typeof item === 'string' ? { source: item } : item;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new InputError(`Invalid Pi package at ${path}`);
    const data = entry as Entry;
    if (typeof data.source !== 'string' || (data.autoload !== undefined && typeof data.autoload !== 'boolean')
      || (data.extensions !== undefined && (!Array.isArray(data.extensions)
      || !data.extensions.every(x => typeof x === 'string')))) throw new InputError(`Invalid Pi package at ${path}`);
    const source = data.source, from = join(path, '..');
    const candidate = source.startsWith('~/') ? resolve(userHome, source.slice(2)) : resolve(from, source);
    const local = isAbsolute(source) || source.startsWith('.') || source.startsWith('~/')
      || existsSync(join(candidate, 'package.json'));
    return { ...data, source: local ? candidate : source };
  });
}
function engine(entry: Entry): boolean {
  if (!isAbsolute(entry.source)) return false;
  try {
    const manifest = JSON.parse(readFileSync(join(entry.source, 'package.json'), 'utf8')) as Record<string, unknown>;
    return manifest['name'] === 'mypi-pi';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new InputError(`Cannot inspect Pi package manifest at ${entry.source}`);
  }
}
/** Read-only diagnostic; it does not alter target project resources or personal Pi settings. */
export function inspectProjectPiPackages(cwd: string, selectedEngine: string,
  env: Readonly<Record<string, string | undefined>>, userHome = homedir()): void {
  const agent = env['PI_CODING_AGENT_DIR'] ?? join(userHome, '.pi', 'agent');
  const personal = settings(join(agent, 'settings.json'), userHome);
  const project = settings(join(cwd, '.pi', 'settings.json'), userHome);
  for (const entries of [personal, project]) {
    const known = entries.filter(engine);
    if (new Set(known.map(entry => entry.source)).size !== known.length)
      throw new InputError('Duplicate mypi Pi package identity in one settings scope; reconcile before opening Herdr');
  }
  const sources = new Set([...personal, ...project].filter(engine).map(entry => entry.source));
  for (const source of sources) {
    if (source === join(selectedEngine, 'integrations', 'pi')) continue;
    const local = project.find(entry => entry.source === source);
    const global = personal.find(entry => entry.source === source);
    // A project replacement with empty extension filters is inert. A filtering delta
    // needs the global entry to be inspected as well, never treated as replacement.
    const selected = local?.autoload === false ? global : local ?? global;
    const negativeOnly = (values: readonly string[]) => values.every(value => value.startsWith('-') || value.startsWith('!'));
    const baseInert = !global || global.extensions?.length === 0
      || (global.autoload === false && (global.extensions === undefined || negativeOnly(global.extensions)));
    // Empty/pure-negative deltas cannot activate an inert base. Positive and
    // nontrivial filters are diagnosed, not interpreted as an invented Pi engine.
    if (local?.autoload === false && local.extensions?.length
      && !(baseInert && negativeOnly(local.extensions))) {
      throw new InputError(`Ambiguous mypi Pi package extension delta at ${source}; reconcile before opening Herdr`);
    }
    if (!selected) continue;
    if (selected.autoload === false && selected.extensions === undefined) continue;
    if (selected.autoload === false && selected.extensions && negativeOnly(selected.extensions)) continue;
    if (selected.extensions?.length) {
      throw new InputError(`Ambiguous mypi Pi package extension filters at ${source}; reconcile before opening Herdr`);
    }
    if (selected?.extensions === undefined) throw new InputError(`Competing mypi Pi package at ${source}; reconcile target/agent package settings before opening Herdr`);
  }
}
