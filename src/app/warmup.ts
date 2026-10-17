import type { ProjectScope } from '../modules/projects/public.js';
import type { createMemory } from '../modules/memory/public.js';
import type { createInbox } from '../modules/inbox/public.js';
import type { Card } from '../modules/requests/public.js';
import type { Entry } from '../modules/knowledge/public.js';
import type { Scope } from '../shared/scope.js';

function brief(text: string) {
  const points = Array.from(text);
  return { text: points.slice(0, 1000).join(''), truncated: points.length > 1000 };
}

export function warmup(scope: ProjectScope, memory: ReturnType<typeof createMemory>, inbox: ReturnType<typeof createInbox>,
  read: (path: string) => string | undefined, projects: unknown[], history: (scope: Scope | 'all', options?: { limit?: number }) => Entry[],
  cards: Card[], projectIds: ReadonlyMap<number, { org: string; code: string }>) {
  const memories = [memory.show('')];
  const matches = (card: Card) => scope.type === 'global' ? card.projectId === null
    : card.projectId !== null && (() => {
      const parent = projectIds.get(card.projectId);
      return scope.type === 'org' ? parent?.org === scope.slug : parent?.code === scope.project.code;
    })();
  const open = cards.filter(card => !card.isTerminal && matches(card))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
  const tasks = open.slice(0, 20).map(card => ({ key: (card.projectId === null ? 'REQ' : projectIds.get(card.projectId)!.code)
    + '-' + card.number, title: brief(card.title), status: card.status, updatedAt: card.updatedAt,
    path: card.contextDir + '/source.md' }));
  const eventScope: Scope = scope.type === 'global' ? { type: 'global' }
    : scope.type === 'org' ? { type: 'org', key: scope.slug } : { type: 'project', key: scope.project.code };
  // journal_read(global) intentionally remains global-only. The work index also includes
  // projectless request events, selected by their persisted request identity.
  const requestless = new Set(cards.filter(card => card.projectId === null).map(card => 'REQ-' + card.number));
  const events = scope.type === 'global'
    ? history('all').filter(entry => entry.scope.type === 'global'
      || (entry.scope.type === 'request' && requestless.has(entry.scope.key)))
    : history(eventScope, { limit: 11 });
  const recent = events.slice(-11);
  const work = { tasks, openTaskCount: open.length, events: recent.slice(-10).map(entry => ({
    ...entry, text: brief(entry.text), read: { scope: entry.scope, at: entry.at } })),
    olderEvents: recent.length > 10 };
  if (scope.type === 'global') return { memory: memories, projects, inbox: inbox.index().slice(-10), work };
  const org = scope.type === 'org' ? scope.slug : scope.project.org;
  memories.push(memory.show('projects/' + org));
  if (scope.type === 'org') return { memory: memories, projects, history: history(eventScope, { limit: 10 }), work };
  const base = 'projects/' + org + '/' + scope.project.slug;
  memories.push(memory.show(base));
  return { memory: memories, glossary: read(base + '/context.md') ?? '',
    history: history(eventScope, { limit: 10 }), work };
}
