import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { validSlug } from '../modules/projects/public.js';
import type { Card } from '../modules/tasks/public.js';
import type { TurnAction } from '../shared/turn-actions.js';
import type { SessionRunner } from './session-operations.js';

export const MAP_LIMIT = 1500;
export const REASON_MAX = 8000;

export interface TurnContext {
  home: string; tmp: string[]; cwd?: string;
  read: (path: string) => string | undefined;
  isDirectory: (path: string) => boolean;
}
export interface TurnFindings {
  documents: { path: string; uploaded: boolean }[];
  publications: { title?: string }[];
  maps: { path: string; length: number; bare: string[] }[];
}

const target = '("[^"]*"|\'[^\']*\'|[^\\s;&|<>()]+)';
const redirect = new RegExp('(?<![0-9&<>])>>?\\|?\\s*' + target, 'g');
const tee = new RegExp('\\btee\\s+(?:-\\S+\\s+)*' + target, 'g');
const unquote = (word: string) => word.replace(/["']/g, '');
const words = (segment: string) => (segment.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) ?? []).map(unquote);

function withoutHeredocs(command: string): string {
  const out: string[] = [], pending: string[] = [];
  for (const line of command.split('\n')) {
    if (pending.length > 0) {
      if (line.trim() === pending[0]) pending.shift();
      continue;
    }
    out.push(line);
    for (const match of line.matchAll(/<<-?\s*['"]?(\w+)['"]?/g)) pending.push(match[1]!);
  }
  return out.join('\n');
}

function under(path: string, dir: string): boolean {
  const d = resolve(dir);
  return path === d || path.startsWith(d + sep);
}

export function turnFindings(actions: TurnAction[], context: TurnContext): TurnFindings | null {
  const homes = [resolve(context.home)];
  try { homes.push(realpathSync(context.home)); } catch { }
  const homeOf = (path: string) => homes.find(h => under(path, h));
  const isTmp = (path: string) => homeOf(path) === undefined && context.tmp.some(d => under(path, d));
  const isDocument = (path: string) => /\.(md|html)$/i.test(path) && isTmp(path);
  const located = (path: string, cwd: string | undefined): string | undefined => {
    if (/[$`]/.test(path)) return undefined;
    const expanded = path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
    return resolve(cwd ?? context.cwd ?? '/', expanded);
  };
  const bashWrites = (command: string, cwd: string | undefined) => {
    const writes: string[] = [], uploads: string[] = [];
    const add = (list: string[], path: string | undefined) => { if (path !== undefined) list.push(path); };
    const text = withoutHeredocs(command);
    for (const match of text.matchAll(redirect)) if (!match[1]!.startsWith('&')) add(writes, located(unquote(match[1]!), cwd));
    for (const match of text.matchAll(tee)) add(writes, located(unquote(match[1]!), cwd));
    for (const segment of text.split(/\n|&&|\|\||\||;/)) {
      const all = words(segment);
      if (all[0] === 'sudo') all.shift();
      if (all[0] === 'cp' || all[0] === 'mv') {
        const rest = all.slice(1).filter(w => !w.startsWith('-'));
        if (rest.length < 2) continue;
        const into = rest[rest.length - 1]!, dir = located(into, cwd);
        if (dir === undefined) continue;
        if (into.endsWith('/') || context.isDirectory(dir)) {
          for (const source of rest.slice(0, -1)) writes.push(join(dir, basename(source)));
        } else writes.push(dir);
      }
      if (all[0] === 'curl') {
        for (let i = 1; i < all.length - 1; i++) {
          const flag = all[i]!, value = all[i + 1]!;
          let path: string | undefined;
          if (flag === '-F' || flag === '--form') path = /^[^=]*=[@<]([^;]*)/.exec(value)?.[1];
          else if (flag === '-T' || flag === '--upload-file') path = value;
          else if (['-d', '--data', '--data-binary', '--data-raw'].includes(flag) && value.startsWith('@')) path = value.slice(1);
          const at = path === undefined ? undefined : located(path, cwd);
          if (at !== undefined && isDocument(at)) uploads.push(at);
        }
      }
    }
    return { writes, uploads };
  };

  const written = new Map<string, string | undefined>();
  const touched: string[] = [], uploaded = new Set<string>(), publications: { content: string; title?: string }[] = [];
  for (const action of actions) {
    if (action.kind === 'write') {
      const path = located(action.path, action.cwd);
      if (path === undefined) continue;
      written.set(path, action.content);
      touched.push(path);
    } else if (action.kind === 'bash') {
      const { writes, uploads } = bashWrites(action.command, action.cwd);
      touched.push(...writes, ...uploads);
      for (const path of uploads) uploaded.add(path);
    } else if (action.kind === 'publish') {
      if (action.content !== undefined) publications.push({ content: action.content, ...(action.title === undefined ? {} : { title: action.title }) });
    } else {
      for (const path of action.paths) touched.push(resolve(context.home, path));
    }
  }
  const contentOf = (path: string) => written.get(path) ?? context.read(path);
  const unique = [...new Set(touched)];
  const inHome = unique.filter(path => homeOf(path) !== undefined);
  const saved = inHome.filter(path => basename(path) !== 'INDEX.md');
  const savedNames = new Set(saved.map(path => basename(path)));
  const savedContents = new Set(saved.map(path => contentOf(path)?.trim()).filter(text => text !== undefined && text !== ''));

  const documents = unique.filter(path => isDocument(path)).filter(path => {
    if (savedNames.has(basename(path))) return false;
    const text = contentOf(path)?.trim();
    return text === undefined || text === '' || !savedContents.has(text);
  }).map(path => ({ path, uploaded: uploaded.has(path) }));
  const unsaved = publications.filter(p => !savedContents.has(p.content.trim())).map(p => p.title === undefined ? {} : { title: p.title });
  const maps: TurnFindings['maps'] = [];
  for (const path of inHome.filter(path => basename(path) === 'INDEX.md')) {
    const text = context.read(path);
    if (text === undefined) continue;
    const bare = text.split('\n').filter(line => /https?:\/\/\S+\/artifacts\/\S+/.test(line)
      && !/[^\s/]+\.(md|html)\b/i.test(line.replace(/https?:\/\/\S+/g, '')));
    if (text.length > MAP_LIMIT || bare.length > 0) maps.push({ path: relative(homeOf(path)!, path), length: text.length, bare });
  }
  return documents.length === 0 && unsaved.length === 0 && maps.length === 0 ? null : { documents, publications: unsaved, maps };
}

function capped(items: string[]): string[] {
  return items.length <= 10 ? items : [...items.slice(0, 10), '- … and ' + (items.length - 10) + ' more'];
}

export function turnReason(findings: TurnFindings, folder: { path: string; label: string }, home: string): string {
  const parts = ['mypi: this turn made files that home does not keep. Per the howto rule, a document made in work lives in home on its level, '
    + 'the derive service publishes a home file, and a link in an INDEX.md is a pointer, not the document.'];
  const { documents, publications, maps } = findings;
  if (documents.length > 0 || publications.length > 0) {
    parts.push('Not saved in home:\n' + capped([
      ...documents.map(d => '- ' + d.path + (d.uploaded ? ' (uploaded with curl)' : ' (written)')),
      ...publications.map(p => '- derive publish ' + (p.title === undefined ? '(untitled)' : '"' + p.title + '"') + ' (its content is not written under home)'),
    ]).join('\n'));
    const shown = documents.slice(0, 10).map(d => d.path);
    const rel = relative(resolve(home), resolve(folder.path));
    const names = (shown.length === 0 ? ['<name>'] : shown.map(path => basename(path))).map(name => rel === '' ? name : rel + '/' + name);
    parts.push('Save each source to ' + folder.path + ' (' + folder.label + '):\n'
      + '1. cp ' + (shown.length === 0 ? ['<file>'] : shown).join(' ') + ' ' + folder.path + '/\n'
      + '2. context_write ' + JSON.stringify({ paths: names, message: '<what the files are>' }) + '\n'
      + '3. git -C ' + home + ' push'
      + (publications.length > 0 ? '\nFor a derive publish, first write its content to a file in that folder.' : ''));
  }
  if (maps.length > 0) {
    parts.push('Maps to fix:\n' + capped(maps.flatMap(map => [
      ...(map.length > MAP_LIMIT ? ['- ' + map.path + ': ' + map.length + ' characters, over ' + MAP_LIMIT
        + ' — move the detail into a branch beside it and leave a pointer.'] : []),
      ...map.bare.slice(0, 3).map(line => '- ' + map.path + ': derive URL without a home file on the line: ' + line.trim().slice(0, 200)
        + ' — link the home file the artifact publishes.'),
    ])).join('\n'));
  }
  parts.push('This check runs once per turn: if a file is disposable, say so and finish.');
  return parts.join('\n\n').slice(0, REASON_MAX);
}

export async function saveFolder(runner: SessionRunner, home: string, key: string): Promise<{ path: string; label: string }> {
  const global = { path: home, label: 'the global level' };
  if (key === 'global' || key === 'all') return global;
  if (validSlug(key)) return { path: join(home, 'projects', key), label: 'the organization folder ' + key };
  if (!/^[A-Z]+$/.test(key) && !/^[A-Z]+-[1-9][0-9]*$/.test(key)) return global;
  const { projects, cards } = await runner.run('warmup_data', { key });
  if (/^[A-Z]+$/.test(key)) {
    const project = projects.find(p => p.code === key);
    return project === undefined ? global : { path: join(home, 'projects', project.org, project.slug), label: 'the project folder ' + key };
  }
  const taskKey = (card: Card) => (card.projectId === null ? 'REQ' : projects.find(p => p.id === card.projectId)?.code) + '-' + card.number;
  const card = cards.find(c => taskKey(c) === key);
  return card === undefined ? global : { path: join(home, card.contextDir), label: 'the task folder ' + key };
}
