import { createApp } from './create-app.js';
import { localTime } from './warmup.js';
import { createJournal } from '../modules/knowledge/public.js';
import type { Entry } from '../modules/knowledge/public.js';
import { validSlug } from '../modules/projects/public.js';
import type { Project } from '../modules/projects/public.js';
import type { Card } from '../modules/tasks/public.js';
import { sameScope } from '../shared/scope.js';

const NEXT = 'Дождись указаний или предложи следующий шаг.';

function localDate(iso: string): string {
  const date = new Date(iso);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function entryLines(entry: Entry): string[] {
  const text = entry.text.replace(/\r?\n/g, ' ');
  const line = '- ' + localDate(entry.at) + ' ' + localTime(entry.at) + ' ' + entry.event_type + ': '
    + (text.length > 300 ? text.slice(0, 300) + '…' : text);
  return entry.artifacts === undefined ? [line] : [line, '  Артефакты: ' + entry.artifacts.map(a => typeof a === 'string' ? a : a.path + '@' + a.commit.slice(0, 7)).join(', ')];
}

function openTasks(project: Project, cards: Card[]): string {
  const open = cards.filter(card => card.projectId === project.id && !card.isTerminal)
    .sort((a, b) => a.statusId - b.statusId || a.number - b.number);
  const groups = new Map<string, string[]>();
  for (const card of open) groups.set(card.status, [...groups.get(card.status) ?? [], '- ' + project.code + '-' + card.number + ' ' + card.title]);
  return open.length === 0 ? 'Открытых задач нет.' : 'Открытые задачи по статусам:\n'
    + [...groups].map(([status, lines]) => status + ' (' + lines.length + '):\n' + lines.join('\n')).join('\n');
}

export function startMessage(filename: string, key: string, worktreePath: string | null): string {
  const app = createApp(filename, true);
  try {
    return app.readSnapshot(() => {
      const projects = app.projects.list(), cards = app.tasks.list();
      if (validSlug(key) && !/^[A-Z]/.test(key)) {
        const own = projects.filter(p => p.org === key).sort((a, b) => a.code.localeCompare(b.code));
        return 'Организация ' + key + ', проектов ' + own.length + '.\n\n'
          + own.map(p => 'Проект ' + p.code + ' (' + p.org + '/' + p.slug + '): ' + openTasks(p, cards)).join('\n\n')
          + '\n\nНедоставленных событий от задач на момент открытия: ' + app.events.pending(key).filter(e => e.kind !== 'message').length + '.\n\n' + NEXT;
      }
      if (/^[A-Z]+$/.test(key)) {
        const project = projects.find(p => p.code === key)!;
        return 'Проект ' + key + ' (' + project.org + '/' + project.slug + ').\n\n' + openTasks(project, cards) + '\n\n'
          + 'Недоставленных событий от задач на момент открытия: ' + app.events.pending(key).filter(e => e.kind !== 'message').length + '.\n\n' + NEXT;
      }
      const [code, number] = key.split('-');
      const project = projects.find(p => p.code === code)!;
      const card = cards.find(c => c.projectId === project.id && c.number === Number(number))!;
      const entries = createJournal(app.journalStore, () => {}, sameScope, () => new Date().toISOString())
        .read({ type: 'task', key }, { limit: 5 });
      const path = worktreePath ?? card.worktreePath;
      return 'Задача ' + key + ' «' + card.title + '», статус ' + card.status + '.\n'
        + 'Worktree: ' + (path ?? 'не создан') + '\n\n'
        + (entries.length === 0 ? 'Записей в журнале задачи нет.' : 'Последние записи журнала задачи:\n' + entries.flatMap(entryLines).join('\n'))
        + '\n\n' + NEXT;
    });
  } finally { app.close(); }
}
