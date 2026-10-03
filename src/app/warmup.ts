import type { ProjectScope } from '../modules/projects/public.js';
import type { createMemory } from '../modules/memory/public.js';
import type { createInbox } from '../modules/inbox/public.js';
import type { Entry } from '../modules/knowledge/public.js';
import type { Scope } from '../shared/scope.js';
export function warmup(scope: ProjectScope, memory: ReturnType<typeof createMemory>, inbox: ReturnType<typeof createInbox>,
  read: (path: string) => string | undefined, projects: unknown[], history: (scope: Scope, options: { limit: number }) => Entry[], list: (path: string) => string[]) {
  const memories = [memory.show('')];
  if (scope.type === 'global') return { memory: memories, projects, inbox: inbox.index().slice(-10) };
  const org = scope.type === 'org' ? scope.slug : scope.project.org;
  memories.push(memory.show('projects/' + org));
  if (scope.type === 'org') return { memory: memories, projects, history: history({ type: 'org', key: org }, { limit: 10 }) };
  const base = 'projects/' + org + '/' + scope.project.slug;
  memories.push(memory.show(base));
  return { memory: memories, glossary: read(base + '/context.md') ?? '',
    legacyJournal: list(base + '/legacy-journal').map(name => base + '/legacy-journal/' + name),
    history: history({ type: 'project', key: scope.project.code }, { limit: 10 }) };
}
