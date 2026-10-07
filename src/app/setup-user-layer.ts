import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync, mkdirSync,
  symlinkSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { contextGit } from '../infrastructure/git/context-git.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { InputError } from '../shared/errors.js';

interface Snapshot { path: string; kind: 'absent' | 'directory' | 'file' | 'link'; content?: string }
type Change = { path: string; kind: 'directory' | 'file' | 'link'; content: string }
  | { path: string; kind: 'legacy-pi'; content: string };
export interface UserLayerPlan {
  root: string;
  snapshots: Snapshot[];
  changes: Change[];
  initializeGit: boolean;
}

function snapshot(path: string): Snapshot {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, kind: 'absent' };
    throw error;
  }
  if (stat.isSymbolicLink()) return { path, kind: 'link', content: readlinkSync(path) };
  if (stat.isDirectory()) return { path, kind: 'directory' };
  if (stat.isFile() && stat.nlink === 1) return { path, kind: 'file', content: readFileSync(path, 'utf8') };
  throw new InputError('Unsupported file or hardlink: ' + path);
}
function conflict(path: string): never {
  throw new InputError('Conflicting user path; nothing overwritten. Reconcile explicitly: ' + path);
}

/** Read-only preflight. Settings are patched only to add the local package, never reset. */
export function planUserLayer(checkout: string): UserLayerPlan {
  const root = realpathSync(checkout), home = join(root, 'home'), pi = join(home, 'pi');
  const plan: UserLayerPlan = { root, snapshots: [], changes: [], initializeGit: false };
  const inspect = (path: string) => {
    const value = snapshot(path); plan.snapshots.push(value); return value;
  };
  const directory = (path: string) => {
    const value = inspect(path);
    if (value.kind === 'absent') plan.changes.push({ path, kind: 'directory', content: '' });
    else if (value.kind !== 'directory') conflict(path);
  };
  const file = (path: string, content: string) => {
    const value = inspect(path);
    if (value.kind === 'absent') plan.changes.push({ path, kind: 'file', content });
    else if (value.kind !== 'file') conflict(path);
    return value;
  };
  const link = (path: string, target: string) => {
    const value = inspect(path);
    if (value.kind === 'absent') plan.changes.push({ path, kind: 'link', content: target });
    else if (value.kind !== 'link' || value.content !== target) conflict(path);
  };
  const packagePath = join(root, 'integrations/pi');
  if (snapshot(join(packagePath, 'package.json')).kind !== 'file') throw new InputError('Missing built-in Pi package');
  directory(home);
  const metadata = inspect(join(home, '.git'));
  if (metadata.kind !== 'absent' && metadata.kind !== 'directory') conflict(metadata.path);
  plan.initializeGit = metadata.kind === 'absent';
  if (!plan.initializeGit) contextGit(home).inspectRepository();
  directory(pi);
  for (const name of ['skills', 'extensions', 'prompts', 'themes']) directory(join(pi, name));
  file(join(home, 'USER-INSTRUCTIONS.md'), '# Personal instructions\n\n');
  link(join(pi, 'APPEND_SYSTEM.md'), '../USER-INSTRUCTIONS.md');
  file(join(pi, 'mcp.json'), '{\n  "mcpServers": {}\n}\n');

  const settingsPath = join(pi, 'settings.json'), settings = inspect(settingsPath);
  if (settings.kind !== 'absent' && settings.kind !== 'file') conflict(settingsPath);
  let config: Record<string, unknown> = {};
  if (settings.kind === 'file') {
    const parsed: unknown = JSON.parse(settings.content!);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('Pi settings must be a JSON object');
    config = parsed as Record<string, unknown>;
  }
  const packages = config['packages'] ?? [];
  if (!Array.isArray(packages)) throw new InputError('Pi settings packages must be an array');
  const sources = packages.map((entry: unknown) => {
    const source = typeof entry === 'string' ? entry : (entry as { source?: unknown } | null)?.source;
    if (typeof source !== 'string') throw new InputError('Invalid Pi package entry');
    return source;
  });
  // Absolute paths avoid ambiguity through the .pi symlink. Preserve filtered entries verbatim.
  if (!sources.some(source => resolve(root, '.pi', source) === packagePath)) {
    if (settings.kind === 'file') {
      const backup = inspect(settingsPath + '.before-bootstrap');
      if (backup.kind !== 'absent') conflict(backup.path);
      plan.changes.push({ path: backup.path, kind: 'file', content: settings.content! });
    }
    plan.changes.push({ path: settingsPath, kind: 'file', content: JSON.stringify({ ...config, packages: [...packages, packagePath] }, null, 2) + '\n' });
  }

  const localPi = inspect(join(root, '.pi'));
  if (localPi.kind === 'directory') {
    const names = readdirSync(localPi.path);
    const legacy = inspect(join(localPi.path, 'APPEND_SYSTEM.md'));
    if (names.length && !(names.length === 1 && names[0] === 'APPEND_SYSTEM.md'
      && legacy.kind === 'link' && legacy.content === '../home/USER-INSTRUCTIONS.md')) conflict(localPi.path);
    plan.changes.push({ path: localPi.path, kind: 'legacy-pi', content: names.length ? 'legacy' : 'empty' });
  } else if (localPi.kind === 'absent') {
    plan.changes.push({ path: localPi.path, kind: 'link', content: 'home/pi' });
  } else if (localPi.kind !== 'link' || resolve(root, localPi.content!) !== pi) conflict(localPi.path);
  return plan;
}

/** Recheck the reviewed plan; no network, DB writes, commits or global Pi configuration. */
export function applyUserLayer(plan: UserLayerPlan): string[] {
  if (JSON.stringify(planUserLayer(plan.root)) !== JSON.stringify(plan)) {
    throw new InputError('User layer changed after preview; rerun bootstrap before applying');
  }
  const saved: string[] = [];
  try {
    for (const change of plan.changes) {
      if (change.kind === 'directory') mkdirSync(change.path, { mode: 0o700 });
      else if (change.kind === 'file') {
        const before = plan.snapshots.find(value => value.path === change.path);
        if (before && JSON.stringify(snapshot(change.path)) !== JSON.stringify(before)) throw new InputError('File changed: ' + change.path);
        const files = contextFiles(plan.root), path = change.path.slice(plan.root.length + 1);
        if (before?.kind === 'file') files.replace(path, change.content, before.content!);
        else files.create(path, change.content);
      } else if (change.kind === 'legacy-pi') {
        if (change.content === 'legacy') unlinkSync(join(change.path, 'APPEND_SYSTEM.md'));
        rmdirSync(change.path); // Refuses unexpected files, never recursively deletes user configuration.
        symlinkSync('home/pi', change.path);
      } else symlinkSync(change.content, change.path);
      saved.push(change.path);
    }
    if (plan.initializeGit) {
      contextGit(join(plan.root, 'home')).initialize();
      saved.push(join(plan.root, 'home/.git'));
    }
    return saved;
  } catch (error) {
    throw new Error(`Setup stopped: ${String(error)}\nSaved: ${saved.join(', ') || 'nothing'}\nInspect before retrying; no automatic rollback.`);
  }
}
