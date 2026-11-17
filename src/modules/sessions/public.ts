import { InputError } from '../../shared/errors.js';
import type { Agent, Registry, RegistryRecord, SessionRow, SessionScope, SessionStore } from './ports.js';
export type { Agent, RegistryRecord, SessionRow, SessionScope } from './ports.js';
export type SessionNode = { key: string; session: { agent: Agent; nativeId: string; state: 'live' | 'closed' } | null;
  sessions: { agent: Agent; nativeId: string; device: string; activeAt: string | null; state: 'live' | 'closed' }[]; children: SessionNode[] };
export function createSessions(store: SessionStore, registry: () => Registry, scope: (key: string) => SessionScope,
  orgOf: (code: string) => string | undefined, clock: () => string, device: () => string) {
  const same = (a: { pid: number; start: string }, b: { pid: number; start: string }) => a.pid === b.pid && a.start === b.start;
  const matches = (record: { agent: Agent; nativeId: string }, row: { agent: Agent; nativeId: string } | undefined) =>
    row !== undefined && record.agent === row.agent && record.nativeId === row.nativeId;
  return {
    register(input: { agent: Agent; nativeId: string; pid: number; name: string | null; socket: string | null; fork: boolean; envScope?: string }):
      { key: string; registered: boolean } {
      if (typeof input.nativeId !== 'string' || input.nativeId === '' || input.nativeId.length > 256
        || /[\u0000-\u001f\u007f]/.test(input.nativeId)) throw new InputError('Invalid native session id');
      if (!Number.isSafeInteger(input.pid) || input.pid <= 0) throw new InputError('--pid must be a positive integer');
      const reg = registry();
      const start = reg.start(input.pid);
      if (start === undefined) throw new InputError('Process ' + input.pid + ' is not running');
      const self = { pid: input.pid, start };
      return store.transaction(() => {
        const records = reg.live(true);
        let key = store.byNative(input.agent, input.nativeId)?.key ?? records.find(r => same(r, self))?.key;
        if (key === undefined) {
          if (input.fork && !input.envScope) return { key: 'global', registered: false };
          key = input.envScope || 'global';
        }
        const target = scope(key);
        for (const r of records) if (same(r, self) && r.key !== key) reg.remove(r);
        const previous = records.find(r => same(r, self) && r.key === key);
        const others = records.filter(r => r.key === key && !same(r, self));
        const wasActive = previous !== undefined && matches(previous, store.active(key));
        reg.write({ key, agent: input.agent, nativeId: input.nativeId, pid: input.pid, start, name: input.name, socket: input.socket,
          permissionMode: input.agent === 'claude' ? reg.permissionMode(input.pid) : null, registeredAt: clock() });
        const id = store.save({ key, ...target, agent: input.agent, nativeId: input.nativeId, device: device(), createdAt: clock() });
        if (others.length === 0 || wasActive) store.touch(id, clock());
        return { key, registered: true };
      });
    },
    prompt(input: { agent: Agent; nativeId: string }): { key: string | null; active: boolean } {
      return store.transaction(() => {
        const row = store.byNative(input.agent, input.nativeId);
        if (row === undefined) return { key: null, active: false };
        store.touch(row.id, clock());
        return { key: row.key, active: true };
      });
    },
    unregister(pid: number): { removed: string[] } {
      return store.transaction(() => {
        const reg = registry();
        const start = reg.start(pid);
        if (start === undefined) return { removed: [] };
        const mine = reg.live(true).filter(r => same(r, { pid, start }));
        for (const r of mine) reg.remove(r);
        return { removed: mine.map(r => r.key) };
      });
    },
    forget(key: string): { forgotten: string; live: boolean } {
      return store.transaction(() => {
        if (store.rows(key).length === 0) throw new InputError('Unknown session: ' + key);
        const live = registry().live(true).some(r => r.key === key);
        store.removeKey(key);
        return { forgotten: key, live };
      });
    },
    lookup(key: string): { row: SessionRow | undefined; live: RegistryRecord | undefined; records: RegistryRecord[] } {
      const rows = store.rows(key);
      const row = rows[0];
      const position = (r: RegistryRecord) => { const i = rows.findIndex(x => matches(r, x)); return i === -1 ? rows.length : i; };
      const records = registry().live().filter(r => r.key === key)
        .sort((a, b) => position(a) - position(b) || b.registeredAt.localeCompare(a.registeredAt));
      return { row, live: records.find(r => matches(r, row)), records };
    },
    tree(): SessionNode {
      const rows = store.list(), records = registry().live();
      const state = (row: SessionRow): 'live' | 'closed' => records.some(r => r.key === row.key && matches(r, row)) ? 'live' : 'closed';
      const node = (key: string): SessionNode => {
        const own = rows.filter(r => r.key === key);
        const row = own[0];
        return { key, session: row ? { agent: row.agent, nativeId: row.nativeId, state: state(row) } : null,
          sessions: own.map(r => ({ agent: r.agent, nativeId: r.nativeId, device: r.device, activeAt: r.activeAt, state: state(r) })), children: [] };
      };
      const root = node('global');
      const codes = [...new Set(rows.map(r => /^[A-Z]+/.exec(r.key)?.[0]).filter((code): code is string => code !== undefined))].sort();
      const orgs = [...new Set([...rows.filter(r => r.scopeType === 'org').map(r => r.key),
        ...codes.map(orgOf).filter((slug): slug is string => slug !== undefined)])].sort();
      for (const slug of orgs) {
        const org = node(slug);
        for (const code of codes.filter(c => orgOf(c) === slug)) {
          const project = node(code);
          project.children = [...new Set(rows.map(r => r.key).filter(key => key.startsWith(code + '-')))]
            .sort((a, b) => Number(a.slice(code.length + 1)) - Number(b.slice(code.length + 1))).map(node);
          org.children.push(project);
        }
        root.children.push(org);
      }
      return root;
    },
    resolve(hint: { agent: Agent; nativeId: string; pid: number }): string | undefined {
      const key = store.byNative(hint.agent, hint.nativeId)?.key;
      if (key !== undefined) return key;
      try {
        const reg = registry();
        const start = reg.start(hint.pid);
        return start === undefined ? undefined : reg.live().find(r => r.pid === hint.pid && r.start === start)?.key;
      } catch { return undefined; }
    },
  };
}
