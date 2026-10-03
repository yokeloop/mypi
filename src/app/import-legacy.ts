import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { canonicalDirectory, externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { contextGit } from '../infrastructure/git/context-git.js';
import { publishedArtifactPaths } from './journal-storage.js';
import { createApp } from './create-app.js';
import { defaultContextRoot } from './create-workspace.js';
import { PartialError } from '../shared/context.js';

export function importLegacy(filename: string, source: string, codes: Record<string, string>, root = defaultContextRoot()) {
  source = resolve(source); root = resolve(root);
  externalDatabasePath(filename, root);
  for (const [a, b] of [[source, root], [root, source]] as const) {
    const rel = relative(a, b);
    if (!rel || (!rel.startsWith('..') && !rel.startsWith('/'))) throw new Error('Use a separate legacy source archive');
  }
  const sourceFiles = contextFiles(source), target = contextFiles(root), git = contextGit(root, () => publishedArtifactPaths(root));
  git.validateJournal();
  const raw: unknown = JSON.parse(readFileSync(sourceFiles.path('projects.json'), 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid legacy passport');
  const projects = Object.entries(raw).map(([identity, value]) => {
    const entry = value as Record<string, unknown>;
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(identity) || !entry || typeof entry !== 'object'
      || identity !== entry['org'] + '/' + entry['name'] || typeof entry['path'] !== 'string'
      || !/^[A-Z]+$/.test(codes[identity] ?? '') || codes[identity] === 'REQ') throw new Error('Invalid legacy project/code: ' + identity);
    if (!lstatSync(entry['path']).isDirectory()) throw new Error('Legacy checkout unavailable: ' + identity);
    return { identity, code: codes[identity]!, checkout: entry['path'] };
  });
  if (new Set(projects.map(p => p.code)).size !== projects.length) throw new Error('Duplicate import codes');
  const orgs = new Set(projects.map(p => p.identity.split('/')[0]!));
  const walk = (base: string): string[] => readdirSync(join(source, base), { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.git') return [];
    const path = base ? base + '/' + entry.name : entry.name;
    sourceFiles.path(path); // no symlinks/hardlinks, including directories
    return entry.isDirectory() ? walk(path) : [path];
  });
  const plan = walk('').sort().map(path => {
    let destination = path;
    const parent = projects.find(p => path.startsWith(p.identity + '/'));
    if (path === 'projects.json') destination = 'legacy/projects.json';
    else if (path === 'inbox.md') destination = 'inbox/legacy-inbox.md';
    else if (parent) {
      const suffix = path.slice(parent.identity.length + 1);
      destination = 'projects/' + parent.identity + '/' + (suffix.startsWith('journal/') ? 'legacy-journal/' + suffix.slice(8) : suffix);
    } else if (orgs.has(path.split('/')[0]!)) destination = 'projects/' + path;
    else if (!['MEMORY.md'].includes(path) && !path.startsWith('notes/')) destination = 'legacy/' + path;
    target.path(destination);
    return { source: path, destination, bytes: readFileSync(sourceFiles.path(path)) };
  });
  const destinations = new Set(plan.map(file => file.destination));
  if (destinations.size !== plan.length || destinations.has('legacy/import.json')
    || [...destinations].some(path => path.split('/').slice(0, -1).some((_, i, parts) => destinations.has(parts.slice(0, i + 1).join('/'))))) {
    throw new Error('Legacy import destination collision');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(projects));
  for (const file of plan) fingerprint.update(file.source + '\0').update(file.bytes);
  const digest = fingerprint.digest('hex'), marker = 'legacy/import.json';
  const oldMarker = target.read(marker);
  if (oldMarker !== undefined) {
    if (JSON.parse(oldMarker).sha256 !== digest) throw new Error('Different legacy source already imported');
    git.clean([marker]);
    const current = createApp(filename, true);
    try {
      for (const p of projects) {
        const row = current.projects.list().find(x => x.org + '/' + x.slug === p.identity);
        if (!row || row.code !== p.code || row.checkoutPath !== canonicalDirectory(p.checkout)) throw new Error('Import receipt does not match authoritative DB; restore consistent state');
      }
    } finally { current.close(); }
    return { status: 'already_imported' };
  }
  const app = createApp(filename, false);
  try {
    for (const file of plan) if (existsSync(target.path(file.destination))
      && !readFileSync(target.path(file.destination)).equals(file.bytes)) throw new Error('Import conflict: ' + file.destination);
    for (const p of projects) {
      const existing = app.projects.list().find(x => x.org + '/' + x.slug === p.identity);
      if (existing && (existing.code !== p.code || existing.checkoutPath !== canonicalDirectory(p.checkout))) throw new Error('Project import conflict: ' + p.identity);
      if (!existing && app.projects.list().some(x => x.code === p.code)) throw new Error('Code already registered');
    }
    app.serialize(() => {
      for (const p of projects) if (!app.projects.list().some(x => x.org + '/' + x.slug === p.identity)) app.projects.add(p.identity, p.code, p.checkout);
    });
    try {
      app.serialize(() => {
        for (const file of plan) {
          if (existsSync(target.path(file.destination))) {
            if (!readFileSync(target.path(file.destination)).equals(file.bytes)) throw new Error('Import changed/conflicting target');
            continue;
          }
          if (!readFileSync(sourceFiles.path(file.source)).equals(file.bytes)) throw new Error('Legacy source changed during import');
          mkdirSync(dirname(target.path(file.destination)), { recursive: true, mode: 0o700 });
          copyFileSync(sourceFiles.path(file.source), target.path(file.destination), constants.COPYFILE_EXCL);
        }
        target.create(marker, JSON.stringify({ version: 1, sha256: digest }) + '\n');
        git.commit([...plan.map(p => p.destination), marker], 'Import legacy archive');
      });
    } catch (e) { throw new PartialError(String(e), ['database'], ['inspect imported files', 'git'], [root]); }
    return { status: 'ok', files: plan.length, projects: projects.length };
  } finally { app.close(); }
}
