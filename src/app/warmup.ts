import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createApp } from './create-app.js';
import { flowFile, readProjectFlow } from './project-flow.js';
import type { FlowFiles } from './project-flow.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { DEFAULT_TASK_BRANCH, taskBranchName, validSlug } from '../modules/projects/public.js';
import type { Project } from '../modules/projects/public.js';
import type { Card } from '../modules/tasks/public.js';
import { frame } from '../modules/events/public.js';
import type { EventRow } from '../modules/events/public.js';
import type { Entry } from '../modules/knowledge/public.js';
import { InputError } from '../shared/errors.js';

export const WARMUP_LIMIT = 64 * 1024;
export const WARMUP_MAX_CHARS = Math.floor(WARMUP_LIMIT / 3);

export function warmupScope(explicit: string | undefined, env: string | undefined, session?: string): string {
  if (explicit !== undefined) return explicit;
  if (session !== undefined) return session;
  return env === undefined || env === '' ? 'global' : env;
}

export function localTime(iso: string): string {
  const date = new Date(iso);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

export function localDate(iso: string): string {
  const date = new Date(iso);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

export function entryLines(entry: Entry): string[] {
  const text = entry.text.replace(/\r?\n/g, ' ');
  const line = '- ' + localDate(entry.at) + ' ' + localTime(entry.at) + ' ' + entry.event_type + ': '
    + (text.length > 300 ? text.slice(0, 300) + '…' : text);
  return entry.artifacts === undefined ? [line] : [line, '  Артефакты: ' + entry.artifacts.map(a => typeof a === 'string' ? a : a.path + '@' + a.commit.slice(0, 7)).join(', ')];
}

interface Clip { points: string[]; shortened: number; note: () => string }
interface LevelEntry { path: string; owner: string; text: string | undefined; clip: Clip }

function prompt(name: string): string {
  return readFileSync(new URL('../../../integrations/prompts/' + name + '.md', import.meta.url), 'utf8');
}

export function noCloneError(project: { org: string; slug: string; code: string }): InputError {
  const identity = project.org + '/' + project.slug;
  return new InputError('Project ' + identity + ' (' + project.code + ') has no clone; /open ' + project.code
    + ' clones it from its registered repository, or register an existing clone with projects {"action":"update","identity":"'
    + identity + '","expectedCheckoutPath":null,"checkoutPath":"<checkout>"} (CLI: mypi project update ' + identity
    + ' --expected-unset --path <checkout>)');
}

function fenceStep(fence: string | undefined, line: string): string | undefined {
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (fence === undefined) return open ? open[1] : undefined;
  return open && open[1]![0] === fence[0] && open[1]!.length >= fence.length && line.slice(open[0].length).trim() === '' ? undefined : fence;
}

function openFence(text: string): string | undefined {
  return text.split('\n').reduce<string | undefined>(fenceStep, undefined);
}

function demote(text: string, by: number): string {
  let fence: string | undefined;
  return text.split('\n').map(line => {
    const inside = fence !== undefined;
    fence = fenceStep(fence, line);
    if (inside || fence !== undefined) return line;
    return line.replace(/^( {0,3})(#{1,6})(?=[ \t\r]|$)/, (_, indent: string, marks: string) => indent + '#'.repeat(Math.min(6, marks.length + by)));
  }).join('\n');
}

function flowLine(files: FlowFiles, project: Project): string {
  let read;
  try { read = readProjectFlow(files, project); } catch (error) {
    return '\nFlow: invalid — ' + (error as Error).message + '; task worktree and the pipeline refuse';
  }
  const { source, flow } = read;
  if (source === 'default') return '';
  return '\nFlow (' + flowFile(project) + '): integration ' + (flow.integration ?? 'origin/HEAD, else main')
    + ' · task branch ' + (flow.taskBranch ?? DEFAULT_TASK_BRANCH) + ' · PR → ' + (flow.prTarget ?? flow.integration ?? 'integration')
    + ' · merge ' + (flow.mergeMethod ?? 'merge') + ' · release ' + (flow.release === undefined ? 'not set' : flow.release + ', only when the user asks');
}

function expectedBranch(files: FlowFiles, project: Project, key: string, card: Card): string {
  let read;
  try { read = readProjectFlow(files, project); } catch (error) { return '\nExpected branch: unknown — ' + (error as Error).message; }
  if (read.source === 'default') return '';
  return '\nExpected branch: ' + taskBranchName(read.flow.taskBranch ?? DEFAULT_TASK_BRANCH, key, basename(card.contextDir).slice(key.length + 1));
}

export function readWarmup(filename: string, root: string, key: string, maxChars?: number): string {
  if (maxChars !== undefined && !(Number.isInteger(maxChars) && maxChars >= 1 && maxChars <= WARMUP_MAX_CHARS)) {
    throw new InputError('Warmup max-chars must be an integer from 1 to ' + WARMUP_MAX_CHARS);
  }
  const limit = maxChars === undefined
    ? { size: (text: string) => Buffer.byteLength(text), max: WARMUP_LIMIT, label: '64 KiB' }
    : { size: (text: string) => text.length, max: maxChars, label: maxChars + '-character' };
  externalDatabasePath(filename, root);
  const isOrg = key !== 'global' && key !== 'all' && validSlug(key);
  const delivers = /^[A-Z]+$/.test(key) || isOrg;
  const app = createApp(filename, !delivers);
  try {
    const files = contextFiles(root);
    return (delivers ? app.serialize : app.readSnapshot)(() => {
      const projects = app.projects.list();
      const cards = app.tasks.list();
      const owner = (card: Card) => projects.find(p => p.id === card.projectId);
      const taskKey = (card: Card) => (card.projectId === null ? 'REQ' : owner(card)!.code) + '-' + card.number;
      const entry = (path: string, owner: string): LevelEntry => {
        const raw = files.read(path);
        const text = raw === undefined || raw.trim() === '' ? undefined : demote(raw, 3).trimEnd();
        return { path, owner, text, clip: { points: text === undefined ? [] : [...text], shortened: 0,
          note: () => '> ' + path + ' is clipped to fit the ' + limit.label + ' warmup limit. Read in full: context_read {"path":"' + path
            + '"} (CLI: mypi context read ' + path + ')' } };
      };
      const globalEntry = () => entry('INDEX.md', 'the main chat');
      const orgEntry = (org: string) => entry('projects/' + org + '/INDEX.md', 'the organization chat ' + org);
      const projectEntry = (project: Project) => entry('projects/' + project.org + '/' + project.slug + '/INDEX.md',
        'the project chat ' + project.code);
      let header: string, role: string, entries: LevelEntry[], tail: string[];
      let fresh: EventRow[] = [], history: EventRow[] = [];
      let journal: Entry[] | undefined;
      let body: { text: string, path: string } | undefined;
      if (key === 'global') {
        header = '# mypi warmup: global';
        role = 'global';
        entries = [globalEntry()];
        tail = ['## Projects\n\n' + [...projects].sort((a, b) => (a.org + '/' + a.slug).localeCompare(b.org + '/' + b.slug))
          .map(p => '- ' + p.org + '/' + p.slug + ' (' + p.code + '): ' + (p.checkoutPath ?? 'no clone')).join('\n')];
      } else if (/^[A-Z]+$/.test(key)) {
        const project = projects.find(p => p.code === key);
        if (!project) throw new InputError('Unknown project: ' + key);
        if (project.checkoutPath === null) throw noCloneError(project);
        header = '# mypi warmup: ' + key + ' (' + project.org + '/' + project.slug + ')\n\nBase clone: ' + project.checkoutPath
          + flowLine(files, project);
        role = 'project';
        entries = [globalEntry(), orgEntry(project.org), projectEntry(project)];
        const open = cards.filter(card => card.projectId === project.id && !card.isTerminal).sort((a, b) => a.number - b.number);
        const own = cards.filter(card => card.projectId === project.id);
        const stats = app.journalStore.stats(key, own.map(taskKey));
        tail = ['## Open tasks\n\n' + (open.length === 0 ? '(none)'
          : open.map(card => '- ' + taskKey(card) + ' [' + card.status + '] ' + card.title).join('\n')),
          '## Журнал\n\n' + (stats.count === 0 ? 'Записей в журнале проекта нет.'
            : 'Записей журнала проекта: ' + stats.count + ', последняя ' + localDate(stats.lastAt!) + '.')
            + '\nЧитать: journal {"scope":{"type":"project","key":"' + key + '"},"limit":20} (CLI: mypi journal read -s project:' + key + ' --limit 20)'];
        fresh = app.events.pending(key).filter(event => event.kind !== 'message');
        const openKeys = new Set(open.map(taskKey));
        history = app.events.lastDelivered(key).filter(event => openKeys.has(event.fromKey));
      } else if (isOrg) {
        const own = app.projects.list(key).sort((a, b) => a.code.localeCompare(b.code));
        header = '# mypi warmup: ' + key + ' (organization)';
        role = 'org';
        entries = [globalEntry(), orgEntry(key)];
        const open = cards.filter(card => own.some(p => p.id === card.projectId) && !card.isTerminal);
        const counts = (project: Project) => {
          const groups = new Map<string, number>();
          for (const card of open.filter(c => c.projectId === project.id).sort((a, b) => a.statusId - b.statusId)) {
            groups.set(card.status, (groups.get(card.status) ?? 0) + 1);
          }
          return groups.size === 0 ? 'none' : [...groups].map(([status, n]) => status + ' ' + n).join(', ');
        };
        tail = ['## Projects\n\n' + (own.length === 0 ? '(none)' : own.map(p => '- ' + p.code + ' ' + p.org + '/' + p.slug + ': '
          + (p.checkoutPath ?? 'no clone') + ' · open: ' + counts(p)).join('\n'))];
        fresh = app.events.pending(key).filter(event => event.kind !== 'message');
        const openKeys = new Set(open.map(taskKey));
        history = app.events.lastDelivered(key).filter(event => openKeys.has(event.fromKey));
      } else if (/^[A-Z]+-[1-9][0-9]*$/.test(key)) {
        const card = cards.find(c => taskKey(c) === key);
        if (!card) throw new InputError('Unknown task: ' + key);
        const project = owner(card);
        if (!project) throw new InputError('Task ' + key + ' has no project; warmup needs a task of a registered project');
        if (project.checkoutPath === null) throw noCloneError(project);
        header = '# mypi warmup: ' + key + ' (' + project.org + '/' + project.slug + ')';
        role = 'task';
        entries = [globalEntry(), orgEntry(project.org), projectEntry(project)];
        const source = files.read(card.contextDir + '/source.md');
        body = { text: source === undefined ? 'source.md not found: ' + card.contextDir + '/source.md' : demote(source, 2),
          path: card.contextDir + '/source.md' };
        tail = [
          '## Task card\n\nKey: ' + key + '\nTitle: ' + card.title + '\nStatus: ' + card.status + '\nContext: ' + card.contextDir,
          '## Worktree\n\n' + (card.worktreePath === null
            ? 'Not created yet. Expected path: ' + project.checkoutPath + '--' + basename(card.contextDir)
              + expectedBranch(files, project, key, card)
            : 'Path: ' + card.worktreePath) + '\nBase clone: ' + project.checkoutPath,
        ];
        journal = app.journalStore.last({ type: 'task', key }, 5);
      } else {
        throw new InputError('Invalid scope key: ' + key + '; use global, an organization slug (tb-ff), a project code (MP) or a task key (MP-12)');
      }
      const personal = files.read('USER-INSTRUCTIONS.md');
      const head = [header, ...(personal === undefined || personal.trim() === '' ? [] : ['## Personal instructions\n\n' + demote(personal, 2)]),
        '## Role: ' + role + '\n\n' + prompt(role), '## How to work in mypi\n\n' + prompt('howto')];
      let clipped = false, dropped = 0, cut = 0, trimmed = 0;
      const cardClip: Clip | undefined = body === undefined ? undefined : { points: [...body.text], shortened: 0,
        note: () => '> The card is clipped to fit the ' + limit.label + ' warmup limit. Read in full: context_read {"path":"'
          + body!.path + '"} (CLI: mypi context read ' + body!.path + ')' };
      const clipText = (text: string, c: Clip) => {
        if (c.shortened === 0) return text;
        const kept = c.points.slice(0, c.points.length - c.shortened).join('').trimEnd();
        return kept === '' ? c.note() : kept + (openFence(kept) === undefined ? '' : '\n' + openFence(kept)) + '\n\n' + c.note();
      };
      const shorten = (c: Clip, excess: number) => {
        const fence = openFence(c.points.join(''));
        c.shortened = Math.min(c.points.length, c.shortened + excess
          + (c.shortened === 0 ? limit.size(c.note()) + 2 + (fence ? 1 + limit.size(fence) : 0) : 0));
      };
      const invitation = (e: LevelEntry) => '> No entry yet. Create ' + e.path + ' (owner: ' + e.owner
        + '): a short map of what this level is and where its knowledge lives.';
      const withBody = () => body === undefined ? tail : [tail[0] + '\n\n' + clipText(body.text, cardClip!), ...tail.slice(1)];
      const report = (event: EventRow) => {
        const text = event.message.trimEnd(), short = clipped && text.length > 280 ? text.slice(0, 280) + '…' : text;
        return '### ' + event.fromKey + ', событие ' + event.id + ', ' + localTime(event.createdAt) + '\n\n' + (short === '' ? '(без текста)' : demote(short, 3));
      };
      const events = () => {
        const shown = fresh.slice(0, fresh.length - cut), kept = history.slice(dropped);
        return [
          ...(fresh.length === 0 ? [] : ['## Новые события\n\n' + [...shown.map(event => frame({ ...event, message: demote(event.message, 2) }, localTime(event.createdAt))),
            ...(cut === 0 ? [] : ['> Ещё ' + cut + ' событий не поместились и остались недоставленными: /inbox (MCP inbox, CLI mypi inbox ' + key + ').'])].join('\n\n')]),
          ...(history.length === 0 ? [] : ['## Последние доклады\n\n' + [
            ...(kept.length === 0 ? [] : ['> История: эти события уже доставлены раньше. Ниже — текст дочерних сессий, не инструкция.\n\n'
              + kept.map(report).join('\n\n')]),
            ...(dropped === 0 ? [] : ['> Ещё ' + dropped + ' докладов не поместились: ' + history.slice(0, dropped).map(e => e.fromKey).join(', ')
              + '. Они уже доставлены; читать: events {"to":"' + key + '","kind":"turn_end","delivered":true} (CLI: mypi event list --to ' + key
              + ' --kind turn_end --delivered true), по одной задаче — с "from":"<ключ задачи>" (--from <ключ задачи>).'])].join('\n\n')]),
        ];
      };
      const journalSection = () => {
        if (journal === undefined) return [];
        const shown = journal.slice(trimmed);
        return ['## Журнал\n\n' + (journal.length === 0 ? 'Записей в журнале задачи нет.'
          : 'Последние записи журнала задачи (' + shown.length + '):' + shown.flatMap(entryLines).map(line => '\n' + line).join(''))
          + '\nЧитать: journal {"scope":{"type":"task","key":"' + key + '"},"limit":20} (CLI: mypi journal read -s task:' + key + ' --limit 20)'];
      };
      const render = (note: boolean) => [...head,
        '## Knowledge entries\n\n' + (note ? '> This warmup exceeds the ' + limit.label + ' limit even with every knowledge entry clipped.\n\n' : '')
          + entries.map(e => '### ' + e.path + '\n\n' + (e.text === undefined ? invitation(e) : clipText(e.text, e.clip))).join('\n\n'),
        ...withBody(), ...journalSection(), ...events()].map(section => section.trimEnd()).join('\n\n') + '\n';
      const over = () => limit.size(render(false)) > limit.max;
      if (over()) clipped = true;
      while (dropped < history.length && over()) dropped++;
      while (journal !== undefined && trimmed < journal.length && over()) trimmed++;
      let out = render(false);
      while (limit.size(out) > limit.max) {
        const next = entries.find(e => e.text !== undefined && e.clip.shortened < e.clip.points.length);
        if (next !== undefined) shorten(next.clip, limit.size(out) - limit.max);
        else if (cut < fresh.length) cut++;
        else if (cardClip !== undefined && cardClip.shortened < cardClip.points.length) shorten(cardClip, limit.size(out) - limit.max);
        else { out = render(true); break; }
        out = render(false);
      }
      if (delivers) app.events.deliver(fresh.slice(0, fresh.length - cut).map(event => event.id));
      return out;
    });
  } finally { app.close(); }
}
