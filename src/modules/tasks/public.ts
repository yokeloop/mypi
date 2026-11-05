import { InputError } from '../../shared/errors.js';
import { matchesQuery, takePage } from '../../shared/page.js';
import type { Page } from '../../shared/page.js';
import type { TaskStore } from './ports.js';
export type { Card, Status } from './ports.js';
export function pageTasks<T extends { id: number; key: string; title: string }>(cards: T[],
  options: { q?: string | undefined; before?: number | undefined; limit: number }): Page<T> {
  const rows = [...cards].sort((a, b) => b.id - a.id)
    .filter(c => (options.before === undefined || c.id < options.before) && matchesQuery(options.q, c.key, c.title));
  return takePage(rows, options.limit, c => c.id);
}
function nonempty(text: string): void { if (typeof text !== 'string' || !text.trim()) throw new InputError('Nonempty text required'); }
export function createTasks(store: TaskStore, clock: () => string,
  project: (id: number) => { code: string; prefix: string }) {
  function status(code: string) {
    const result = store.statuses().find(s => s.code === code);
    if (!result) throw new InputError('Unknown/omitted status; allowed: ' + store.statuses().map(s => s.code).join(', '));
    return result;
  }
  return {
    list: () => store.list(),
    get: (id: number) => store.get(id),
    statuses: () => store.statuses(),
    addStatus(code: string, terminal: boolean) {
      nonempty(code); if (typeof terminal !== 'boolean') throw new InputError('Terminal must be boolean');
      store.transaction(() => store.addStatus(code, terminal));
    },
    renameStatus(code: string, next: string) { nonempty(next); store.transaction(() => { status(code); store.renameStatus(code, next); }); },
    setTerminal(code: string, terminal: boolean) {
      if (typeof terminal !== 'boolean') throw new InputError('Terminal must be boolean');
      store.transaction(() => { status(code); store.terminalStatus(code, terminal); });
    },
    removeStatus(code: string) { store.transaction(() => { status(code); store.removeStatus(code); }); },
    create(input: { projectId: number | null; slug: string; title: string; status: string; parentId?: number | null },
      saveSource: (contextDir: string) => void) {
      nonempty(input.title);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw new InputError('Invalid English slug');
      if (input.projectId === null) throw new InputError('Project required');
      const projectId = input.projectId;
      return store.transaction(() => {
        if (input.parentId !== undefined && input.parentId !== null && store.get(input.parentId).projectId !== projectId)
          throw new InputError('Parent task must belong to the same project');
        const state = status(input.status), number = store.nextNumber(projectId);
        if (!Number.isSafeInteger(number) || number < 1) throw new InputError('Number exhausted');
        const parent = project(projectId);
        const contextDir = parent.prefix + '/' + parent.code + '-' + number + '-' + input.slug;
        const at = clock();
        saveSource(contextDir);
        return store.insert({ projectId, number, title: input.title, statusId: state.id,
          contextDir, parentId: input.parentId ?? null, createdAt: at, updatedAt: at });
      });
    },
    change(id: number, input: { title?: string; status?: string }, reason: string) {
      nonempty(reason);
      return store.transaction(() => {
        const before = store.get(id);
        if (input.title !== undefined) nonempty(input.title);
        const next = input.status === undefined ? before.statusId : status(input.status).id;
        const title = input.title ?? before.title;
        if (next === before.statusId && title === before.title) return { before, after: before, changed: false };
        if (before.isTerminal && next !== before.statusId) throw new InputError('Terminal task cannot change status; create a continuation');
        return { before, after: store.update(id, title, next, clock()), changed: true };
      });
    },
    setParent(id: number, parentId: number | null, reason: string) {
      nonempty(reason);
      return store.transaction(() => {
        const before = store.get(id);
        if (parentId === before.parentId) return { before, after: before, changed: false };
        if (parentId !== null) {
          if (parentId === id) throw new InputError('A task cannot be its own parent');
          const parent = store.get(parentId);
          if (parent.projectId !== before.projectId) throw new InputError('Parent task must belong to the same project');
          for (let at: number | null = parent.parentId; at !== null; at = store.get(at).parentId)
            if (at === id) throw new InputError('Parent would create a cycle');
        }
        return { before, after: store.setParent(id, parentId, clock()), changed: true };
      });
    },
    relocate(id: number, contextDir: string) {
      nonempty(contextDir);
      return store.transaction(() => { store.get(id); return store.relocate(id, contextDir); });
    },
    recordWorktree(id: number, worktreePath: string) {
      nonempty(worktreePath);
      return store.transaction(() => { store.get(id); return store.setWorktree(id, worktreePath); });
    },
    touch(id: number) { return store.transaction(() => { const card = store.get(id); return store.update(id, card.title, card.statusId, clock()); }); },
  };
}
