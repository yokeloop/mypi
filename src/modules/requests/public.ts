import { InputError } from '../../shared/errors.js';
import type { RequestStore } from './ports.js';
export type { Card, Status } from './ports.js';
function nonempty(text: string): void { if (typeof text !== 'string' || !text.trim()) throw new InputError('Nonempty text required'); }
export function createRequests(store: RequestStore, clock: () => string,
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
    create(input: { projectId: number | null; slug: string; title: string; status: string },
      saveSource: (contextDir: string) => void) {
      nonempty(input.title);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw new InputError('Invalid English slug');
      return store.transaction(() => {
        const state = status(input.status), number = store.nextNumber(input.projectId);
        if (!Number.isSafeInteger(number) || number < 1) throw new InputError('Number exhausted');
        const parent = input.projectId === null ? { prefix: 'requests', code: 'REQ' } : project(input.projectId);
        const contextDir = parent.prefix + '/' + parent.code + '-' + number + '-' + input.slug;
        const at = clock();
        saveSource(contextDir);
        return store.insert({ projectId: input.projectId, number, title: input.title, statusId: state.id,
          contextDir, createdAt: at, updatedAt: at });
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
        if (before.isTerminal && next !== before.statusId) throw new InputError('Terminal request cannot change status; create a continuation');
        return { before, after: store.update(id, title, next, clock()), changed: true };
      });
    },
    touch(id: number) { return store.transaction(() => { const card = store.get(id); return store.update(id, card.title, card.statusId, clock()); }); },
  };
}
