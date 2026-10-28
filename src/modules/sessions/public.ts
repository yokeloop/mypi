import { InputError } from '../../shared/errors.js';
import type { Agent, Registry, RegistryRecord, SessionScope, SessionStore } from './ports.js';
export type { Agent, RegistryRecord, SessionRow } from './ports.js';
export type SessionNode = { key: string; session: { agent: Agent; nativeId: string; state: 'live' | 'closed' } | null; children: SessionNode[] };
export function createSessions(store: SessionStore, registry: () => Registry, scope: (key: string) => SessionScope, clock: () => string) {
  const same = (a: { pid: number; start: string }, b: { pid: number; start: string }) => a.pid === b.pid && a.start === b.start;
  const canonical = (records: RegistryRecord[], key: string) => records.find(r => r.key === key && r.displacedAt === undefined);
  return {
    register(input: { agent: Agent; nativeId: string; pid: number; name: string | null; socket: string | null; fork: boolean; envScope?: string }):
      { key: string; registered: boolean; displaced: RegistryRecord | null } {
      if (typeof input.nativeId !== 'string' || input.nativeId === '' || input.nativeId.length > 256
        || /[\u0000-\u001f\u007f]/.test(input.nativeId)) throw new InputError('Invalid native session id');
      if (!Number.isSafeInteger(input.pid) || input.pid <= 0) throw new InputError('--pid must be a positive integer');
      const reg = registry();
      const start = reg.start(input.pid);
      if (start === undefined) throw new InputError('Process ' + input.pid + ' is not running');
      const self = { pid: input.pid, start };
      return store.transaction(() => {
        const records = reg.live();
        let key = store.byNative(input.agent, input.nativeId)?.key ?? records.find(r => same(r, self))?.key;
        if (key === undefined) {
          if (input.fork && !input.envScope) return { key: 'global', registered: false, displaced: null };
          key = input.envScope || 'global';
        }
        const target = scope(key);
        for (const r of records) if (same(r, self) && (r.key !== key || r.displacedAt !== undefined)) reg.remove(r);
        const current = canonical(records, key);
        const displaced = current !== undefined && !same(current, self) ? reg.displace(current, clock()) : null;
        reg.write({ key, agent: input.agent, nativeId: input.nativeId, pid: input.pid, start, name: input.name, socket: input.socket,
          permissionMode: input.agent === 'claude' ? reg.permissionMode(input.pid) : null, registeredAt: clock() });
        store.save({ key, ...target, agent: input.agent, nativeId: input.nativeId, createdAt: store.get(key)?.createdAt ?? clock() });
        return { key, registered: true, displaced };
      });
    },
    unregister(pid: number): { removed: string[] } {
      return store.transaction(() => {
        const reg = registry();
        const start = reg.start(pid);
        if (start === undefined) return { removed: [] };
        const mine = reg.live().filter(r => same(r, { pid, start }));
        for (const r of mine) reg.remove(r);
        return { removed: mine.map(r => r.key) };
      });
    },
    forget(key: string): { forgotten: string; live: boolean } {
      return store.transaction(() => {
        if (!store.get(key)) throw new InputError('Unknown session: ' + key);
        const live = canonical(registry().live(), key) !== undefined;
        store.remove(key);
        return { forgotten: key, live };
      });
    },
    tree(): SessionNode {
      const rows = store.list(), records = registry().live();
      const node = (key: string): SessionNode => {
        const row = rows.find(r => r.key === key);
        return { key, session: row ? { agent: row.agent, nativeId: row.nativeId, state: canonical(records, key) ? 'live' : 'closed' } : null, children: [] };
      };
      const root = node('global');
      const codes = [...new Set(rows.map(r => /^[A-Z]+/.exec(r.key)?.[0]).filter((code): code is string => code !== undefined))].sort();
      for (const code of codes) {
        const project = node(code);
        project.children = rows.map(r => r.key).filter(key => key.startsWith(code + '-'))
          .sort((a, b) => Number(a.slice(code.length + 1)) - Number(b.slice(code.length + 1))).map(node);
        root.children.push(project);
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
