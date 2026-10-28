import { lstatSync, readFileSync, readlinkSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { contextGit } from '../infrastructure/git/context-git.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { InputError } from '../shared/errors.js';
import { initializeState } from './create-app.js';
import { externalDatabasePath } from '../infrastructure/filesystem/paths.js';

interface Snapshot { path: string; kind: 'absent' | 'directory' | 'file' | 'link'; content?: string }
type Change = { path: string; kind: 'directory' | 'file'; content: string };
export interface UserLayerPlan {
  root: string;
  snapshots: Snapshot[];
  changes: Change[];
  initializeGit: boolean;
  database: { path: string; create: boolean };
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

/** Read-only preflight. Creates missing home files only; never touches agent settings. */
export function planUserLayer(checkout: string, database: string): UserLayerPlan {
  const root = realpathSync(checkout), home = join(root, 'home');
  const filename = externalDatabasePath(database, root);
  let create = false;
  try {
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.nlink !== 1) conflict(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    create = true;
  }
  const plan: UserLayerPlan = { root, snapshots: [], changes: [], initializeGit: false,
    database: { path: filename, create } };
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
  directory(home);
  const metadata = inspect(join(home, '.git'));
  if (metadata.kind !== 'absent' && metadata.kind !== 'directory') conflict(metadata.path);
  plan.initializeGit = metadata.kind === 'absent';
  if (!plan.initializeGit) contextGit(home).inspectRepository();
  file(join(home, 'USER-INSTRUCTIONS.md'), '# Personal instructions\n\n');
  file(join(home, 'settings.json'), '{\n  "defaultAgent": "claude"\n}\n');
  return plan;
}

/** Recheck the reviewed plan; create an absent DB only, never reset/migrate an existing one. */
export function applyUserLayer(plan: UserLayerPlan): string[] {
  if (JSON.stringify(planUserLayer(plan.root, plan.database.path)) !== JSON.stringify(plan)) {
    throw new InputError('User layer changed after preview; rerun bootstrap before applying');
  }
  const saved: string[] = [];
  try {
    for (const change of plan.changes) {
      if (change.kind === 'directory') mkdirSync(change.path, { mode: 0o700 });
      else {
        const before = plan.snapshots.find(value => value.path === change.path);
        if (before && JSON.stringify(snapshot(change.path)) !== JSON.stringify(before)) throw new InputError('File changed: ' + change.path);
        const files = contextFiles(plan.root), path = change.path.slice(plan.root.length + 1);
        files.create(path, change.content);
      }
      saved.push(change.path);
    }
    if (plan.initializeGit) {
      contextGit(join(plan.root, 'home')).initialize();
      saved.push(join(plan.root, 'home/.git'));
    }
    if (plan.database.create) {
      initializeState(plan.database.path, true);
      saved.push(plan.database.path);
    }
    return saved;
  } catch (error) {
    throw new Error(`Setup stopped: ${String(error)}\nSaved: ${saved.join(', ') || 'nothing'}\nInspect ${plan.database.path} and user files before retrying; no automatic rollback.`);
  }
}
