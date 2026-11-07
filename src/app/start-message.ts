import { createApp } from './create-app.js';
import { validSlug } from '../modules/projects/public.js';
import type { Project } from '../modules/projects/public.js';
import type { Card } from '../modules/tasks/public.js';

const NEXT = 'Дождись указаний или предложи следующий шаг.';

function openTasks(project: Project, cards: Card[]): string {
  const open = cards.filter(card => card.projectId === project.id && !card.isTerminal)
    .sort((a, b) => a.statusId - b.statusId || a.number - b.number);
  const groups = new Map<string, string[]>();
  for (const card of open) groups.set(card.status, [...groups.get(card.status) ?? [], '- ' + project.code + '-' + card.number + ' ' + card.title]);
  return open.length === 0 ? 'Открытых задач нет.' : 'Открытые задачи по статусам:\n'
    + [...groups].map(([status, lines]) => status + ' (' + lines.length + '):\n' + lines.join('\n')).join('\n');
}

export function startMessage(filename: string, key: string): string {
  const app = createApp(filename, true);
  try {
    return app.readSnapshot(() => {
      const projects = app.projects.list(), cards = app.tasks.list();
      if (validSlug(key) && !/^[A-Z]/.test(key)) {
        const own = projects.filter(p => p.org === key).sort((a, b) => a.code.localeCompare(b.code));
        return 'Организация ' + key + ', проектов ' + own.length + '.\n\n'
          + own.map(p => 'Проект ' + p.code + ' (' + p.org + '/' + p.slug + '): ' + openTasks(p, cards)).join('\n\n') + '\n\n' + NEXT;
      }
      if (/^[A-Z]+$/.test(key)) {
        const project = projects.find(p => p.code === key)!;
        return 'Проект ' + key + ' (' + project.org + '/' + project.slug + ').\n\n' + NEXT;
      }
      const [code, number] = key.split('-');
      const project = projects.find(p => p.code === code)!;
      const card = cards.find(c => c.projectId === project.id && c.number === Number(number))!;
      return 'Задача ' + key + ' «' + card.title + '».\n\n' + NEXT;
    });
  } finally { app.close(); }
}
