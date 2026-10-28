import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createApp } from './create-app.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { factLines } from '../modules/memory/public.js';
import type { Project } from '../modules/projects/public.js';
import type { Card } from '../modules/tasks/public.js';
import { InputError } from '../shared/errors.js';

export const WARMUP_LIMIT = 64 * 1024;

export function warmupScope(explicit: string | undefined, env: string | undefined): string {
  if (explicit !== undefined) return explicit;
  return env === undefined || env === '' ? 'global' : env;
}

interface Zone { path: string; scope: string; cli: string; text: string | undefined; facts: number[] }

function prompt(name: string): string {
  return readFileSync(new URL('../../../integrations/prompts/' + name + '.md', import.meta.url), 'utf8');
}

function noClone(project: Project): InputError {
  const identity = project.org + '/' + project.slug;
  return new InputError('Project ' + identity + ' (' + project.code + ') has no clone; register one with project_update {"identity":"'
    + identity + '","expectedCheckoutPath":null,"checkoutPath":"<checkout>"} (CLI: mypi project update ' + identity
    + ' --expected-unset --path <checkout>)');
}

function marker(zone: Zone, hidden: number): string {
  return '> ' + hidden + ' older facts hidden from ' + zone.path + ' to fit the 64 KiB warmup limit. Read in full: memory_show '
    + zone.scope + ' (CLI: mypi memory show' + zone.cli + ')';
}

function memoryText(zone: Zone, hidden: number): string {
  if (zone.text === undefined || zone.text.trimEnd() === '') return '(empty)';
  if (hidden === 0) return zone.text.trimEnd();
  const gone = new Set(zone.facts.slice(0, hidden));
  return zone.text.split('\n').flatMap((line, index) => index === zone.facts[0] ? [marker(zone, hidden)]
    : gone.has(index) ? [] : [line]).join('\n').trimEnd();
}

export function readWarmup(filename: string, root: string, key: string): string {
  externalDatabasePath(filename, root);
  const app = createApp(filename, true);
  try {
    const files = contextFiles(root);
    return app.readSnapshot(() => {
      const projects = app.projects.list();
      const cards = app.tasks.list();
      const owner = (card: Card) => projects.find(p => p.id === card.projectId);
      const taskKey = (card: Card) => (card.projectId === null ? 'REQ' : owner(card)!.code) + '-' + card.number;
      const zone = (path: string, scope: object, cli: string): Zone => {
        const text = files.read(path);
        return { path, scope: JSON.stringify({ scope }), cli, text, facts: text === undefined ? [] : factLines(text) };
      };
      const projectZone = (project: Project) => zone('projects/' + project.org + '/' + project.slug + '/MEMORY.md',
        { type: 'project', key: project.code }, ' -s ' + project.org + '/' + project.slug);
      const orgZone = (project: Project) => zone('projects/' + project.org + '/MEMORY.md',
        { type: 'org', key: project.org }, ' -s ' + project.org);
      let header: string, role: string, zones: Zone[], tail: string[];
      if (key === 'global') {
        header = '# mypi warmup: global';
        role = 'global';
        zones = [zone('MEMORY.md', { type: 'global' }, '')];
        tail = ['## Projects\n\n' + [...projects].sort((a, b) => (a.org + '/' + a.slug).localeCompare(b.org + '/' + b.slug))
          .map(p => '- ' + p.org + '/' + p.slug + ' (' + p.code + '): ' + (p.checkoutPath ?? 'no clone')).join('\n')];
      } else if (/^[A-Z]+$/.test(key)) {
        const project = projects.find(p => p.code === key);
        if (!project) throw new InputError('Unknown project: ' + key);
        if (project.checkoutPath === null) throw noClone(project);
        header = '# mypi warmup: ' + key + ' (' + project.org + '/' + project.slug + ')\n\nBase clone: ' + project.checkoutPath;
        role = 'project';
        zones = [orgZone(project), projectZone(project)];
        const open = cards.filter(card => card.projectId === project.id && !card.isTerminal).sort((a, b) => a.number - b.number);
        tail = ['## Open tasks\n\n' + (open.length === 0 ? '(none)'
          : open.map(card => '- ' + taskKey(card) + ' [' + card.status + '] ' + card.title).join('\n'))];
      } else if (/^[A-Z]+-[1-9][0-9]*$/.test(key)) {
        const card = cards.find(c => taskKey(c) === key);
        if (!card) throw new InputError('Unknown task: ' + key);
        const project = owner(card);
        if (!project) throw new InputError('Task ' + key + ' has no project; warmup needs a task of a registered project');
        if (project.checkoutPath === null) throw noClone(project);
        header = '# mypi warmup: ' + key + ' (' + project.org + '/' + project.slug + ')';
        role = 'task';
        zones = [projectZone(project)];
        const source = files.read(card.contextDir + '/source.md');
        tail = [
          '## Task card\n\nKey: ' + key + '\nTitle: ' + card.title + '\nStatus: ' + card.status + '\nContext: ' + card.contextDir
            + '\n\n' + (source ?? 'source.md not found: ' + card.contextDir + '/source.md'),
          '## Worktree\n\n' + (card.worktreePath === null
            ? 'Not created yet. Expected path: ' + project.checkoutPath + '--' + basename(card.contextDir)
            : 'Path: ' + card.worktreePath) + '\nBase clone: ' + project.checkoutPath,
        ];
      } else {
        throw new InputError('Invalid scope key: ' + key + '; use global, a project code (MP) or a task key (MP-12)');
      }
      const personal = files.read('USER-INSTRUCTIONS.md');
      const head = [header, ...(personal === undefined || personal.trim() === '' ? [] : ['## Personal instructions\n\n' + personal]),
        '## Role: ' + role + '\n\n' + prompt(role), '## How to work in mypi\n\n' + prompt('howto')];
      const render = (hidden: number[], note: boolean) => [...head,
        '## Memory\n\n' + (note ? '> This warmup exceeds the 64 KiB limit even without memory facts; all facts are hidden.\n\n' : '')
          + zones.map((z, i) => '### ' + z.path + '\n\n' + memoryText(z, hidden[i]!)).join('\n\n'),
        ...tail].map(section => section.trimEnd()).join('\n\n') + '\n';
      const size = (text: string) => Buffer.byteLength(text);
      const lines = zones.map(z => { const all = (z.text ?? '').split('\n'); return z.facts.map(line => size(all[line]!) + 1); });
      const hidden = zones.map(() => 0);
      let out = render(hidden, false);
      let excess = size(out) - WARMUP_LIMIT;
      for (let i = 0; i < zones.length && excess > 0; i++) {
        let saved = 0;
        for (let h = 1; h <= lines[i]!.length; h++) {
          saved += lines[i]![h - 1]!;
          hidden[i] = h;
          if (saved - size(marker(zones[i]!, h)) - 1 >= excess) break;
        }
        if (hidden[i]! > 0) excess -= saved - size(marker(zones[i]!, hidden[i]!)) - 1;
      }
      out = render(hidden, false);
      while (size(out) > WARMUP_LIMIT) {
        const next = zones.findIndex((_, i) => hidden[i]! < lines[i]!.length);
        if (next === -1) return render(hidden, true);
        hidden[next]!++;
        out = render(hidden, false);
      }
      return out;
    });
  } finally { app.close(); }
}
