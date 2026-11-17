import { InputError } from '../../shared/errors.js';
import type { Agent, Registry, RegistryRecord, SessionRow, SessionScope, SessionStore } from './ports.js';
export type { Agent, RegistryRecord, SessionRow, SessionScope } from './ports.js';
export type SessionNode = { key: string; session: { agent: Agent; nativeId: string; state: 'live' | 'closed' } | null;
  sessions: { agent: Agent; nativeId: string; device: string; activeAt: string | null; state: 'live' | 'closed' }[]; children: SessionNode[] };
type Identity = { agent: Agent; nativeId: string };
type Keyed = Identity & { key: string };
const same = (a: { pid: number; start: string }, b: { pid: number; start: string }) => a.pid === b.pid && a.start === b.start;
const matches = (record: { agent: Agent; nativeId: string }, row: { agent: Agent; nativeId: string } | undefined) =>
  row !== undefined && record.agent === row.agent && record.nativeId === row.nativeId;
export type DeviceSessions = ReturnType<typeof createDeviceSessions>;
export function createDeviceSessions(registry: () => Registry, clock: () => string) {
  const keyed = (r: RegistryRecord): Keyed => ({ key: r.key, agent: r.agent, nativeId: r.nativeId });
  return {
    prepare(input: { agent: Agent; nativeId: string; pid: number; fork: boolean; envScope?: string }):
      { start: string; candidateKey: string | null; own: Keyed[]; otherLive: Keyed[] } {
      if (typeof input.nativeId !== 'string' || input.nativeId === '' || input.nativeId.length > 256
        || /[\u0000-\u001f\u007f]/.test(input.nativeId)) throw new InputError('Invalid native session id');
      if (!Number.isSafeInteger(input.pid) || input.pid <= 0) throw new InputError('--pid must be a positive integer');
      const reg = registry();
      const start = reg.start(input.pid);
      if (start === undefined) throw new InputError('Process ' + input.pid + ' is not running');
      const self = { pid: input.pid, start };
      const records = reg.live(true);
      return { start, candidateKey: records.find(r => same(r, self))?.key ?? null,
        own: records.filter(r => same(r, self)).map(keyed), otherLive: records.filter(r => !same(r, self)).map(keyed) };
    },
    record(key: string, input: { agent: Agent; nativeId: string; pid: number; start: string; name: string | null; socket: string | null; herdrName?: string }): void {
      const reg = registry();
      for (const r of reg.live(true)) if (same(r, input) && r.key !== key) reg.remove(r);
      reg.write({ key, agent: input.agent, nativeId: input.nativeId, pid: input.pid, start: input.start, name: input.name, socket: input.socket,
        permissionMode: input.agent === 'claude' ? reg.permissionMode(input.pid) : null, registeredAt: clock(),
        ...(input.herdrName === undefined ? {} : { herdrName: input.herdrName }) });
    },
    unregister(pid: number): { removed: string[] } {
      const reg = registry();
      const start = reg.start(pid);
      if (start === undefined) return { removed: [] };
      const mine = reg.live(true).filter(r => same(r, { pid, start }));
      for (const r of mine) reg.remove(r);
      return { removed: mine.map(r => r.key) };
    },
    isLive(key: string): boolean { return registry().live(true).some(r => r.key === key); },
    recordOf(pid: number): RegistryRecord | undefined {
      const reg = registry();
      const start = reg.start(pid);
      return start === undefined ? undefined : reg.live().find(r => r.pid === pid && r.start === start);
    },
    ownRecord(agent: Agent, nativeId: string): RegistryRecord | undefined {
      try { return registry().live().find(r => r.agent === agent && r.nativeId === nativeId); } catch { return undefined; }
    },
    liveOf(key: string): RegistryRecord[] { return registry().live().filter(r => r.key === key); },
    records(): RegistryRecord[] { return registry().live(); },
    start(pid: number): string | undefined { return registry().start(pid); },
  };
}
export function sessionTree(rows: SessionRow[], records: RegistryRecord[], orgOf: (code: string) => string | undefined): SessionNode {
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
}
export function createSessions(store: SessionStore, registry: () => Registry, scope: (key: string) => SessionScope,
  orgOf: (code: string) => string | undefined, clock: () => string, device: () => string) {
  const half = createDeviceSessions(registry, clock);
  const saveRow = (input: Identity & { device: string; candidateKey: string | null; fork: boolean; envScope?: string; otherLive: Keyed[]; own: Keyed[] }):
    { key: string; registered: boolean } => store.transaction(() => {
    let key = store.byNative(input.agent, input.nativeId)?.key ?? input.candidateKey;
    if (key === undefined || key === null) {
      if (input.fork && !input.envScope) return { key: 'global', registered: false };
      key = input.envScope || 'global';
    }
    const target = scope(key);
    const previous = input.own.find(r => r.key === key);
    const others = input.otherLive.filter(r => r.key === key);
    const wasActive = previous !== undefined && matches(previous, store.active(key));
    const id = store.save({ key, ...target, agent: input.agent, nativeId: input.nativeId, device: input.device, createdAt: clock() });
    if (others.length === 0 || wasActive) store.touch(id, clock());
    return { key, registered: true };
  });
  const forgetRows = (key: string): { forgotten: string } => store.transaction(() => {
    if (store.rows(key).length === 0) throw new InputError('Unknown session: ' + key);
    store.removeKey(key);
    return { forgotten: key };
  });
  return {
    register(input: { agent: Agent; nativeId: string; pid: number; name: string | null; socket: string | null; fork: boolean; envScope?: string; herdrName?: string }):
      { key: string; registered: boolean } {
      const prep = half.prepare(input);
      return store.transaction(() => {
        const saved = saveRow({ agent: input.agent, nativeId: input.nativeId, device: device(), candidateKey: prep.candidateKey, fork: input.fork,
          ...(input.envScope === undefined ? {} : { envScope: input.envScope }), otherLive: prep.otherLive, own: prep.own });
        if (saved.registered) half.record(saved.key, { agent: input.agent, nativeId: input.nativeId, pid: input.pid, start: prep.start, name: input.name,
          socket: input.socket, ...(input.herdrName === undefined ? {} : { herdrName: input.herdrName }) });
        return saved;
      });
    },
    nativeKey(input: Identity): string | null { return store.byNative(input.agent, input.nativeId)?.key ?? null; },
    rowId(input: Identity): number | undefined { return store.byNative(input.agent, input.nativeId)?.id; },
    activeRow(key: string): SessionRow | undefined { return store.active(key); },
    saveRow,
    forgetRows,
    prompt(input: { agent: Agent; nativeId: string }):
      { key: string | null; active: boolean; id: number | null; previous: { agent: Agent; device: string } | null; since: string | null } {
      return store.transaction(() => {
        const row = store.byNative(input.agent, input.nativeId);
        if (row === undefined) return { key: null, active: false, id: null, previous: null, since: null };
        const before = store.active(row.key);
        const previous = before !== undefined && before.id !== row.id ? { agent: before.agent, device: before.device } : null;
        store.touch(row.id, clock());
        return { key: row.key, active: true, id: row.id, previous, since: row.activeAt };
      });
    },
    unregister(pid: number): { removed: string[] } { return half.unregister(pid); },
    forget(key: string): { forgotten: string; live: boolean } {
      return store.transaction(() => {
        const forgotten = forgetRows(key);
        return { ...forgotten, live: half.isLive(key) };
      });
    },
    lookup(key: string): { row: SessionRow | undefined; live: RegistryRecord | undefined; records: RegistryRecord[]; rows: SessionRow[] } {
      const rows = store.rows(key);
      const row = rows[0];
      const position = (r: RegistryRecord) => { const i = rows.findIndex(x => matches(r, x)); return i === -1 ? rows.length : i; };
      const records = registry().live().filter(r => r.key === key)
        .sort((a, b) => position(a) - position(b) || b.registeredAt.localeCompare(a.registeredAt));
      return { row, live: records.find(r => matches(r, row)), records, rows };
    },
    tree(): SessionNode { return sessionTree(store.list(), registry().live(), orgOf); },
    rows(): SessionRow[] { return store.list(); },
    device(): string { return device(); },
    liveRecords(): RegistryRecord[] { return registry().live(); },
    activate(input: { key: string; agent: Agent; nativeId: string; device?: string }): void {
      store.transaction(() => {
        const id = store.save({ key: input.key, ...scope(input.key), agent: input.agent, nativeId: input.nativeId, device: input.device ?? device(), createdAt: clock() });
        store.touch(id, clock());
      });
    },
    ownRecord(key: string, session: { agent: Agent; nativeId: string }): RegistryRecord | undefined {
      try {
        return registry().live().find(r => r.key === key && r.agent === session.agent && r.nativeId === session.nativeId);
      } catch { return undefined; }
    },
    callerRow(hint: { agent: Agent; nativeId: string; pid: number }): number | undefined {
      const id = store.byNative(hint.agent, hint.nativeId)?.id;
      if (id !== undefined) return id;
      try {
        const reg = registry();
        const start = reg.start(hint.pid);
        const record = start === undefined ? undefined : reg.live().find(r => r.pid === hint.pid && r.start === start);
        return record === undefined ? undefined : store.byNative(record.agent, record.nativeId)?.id;
      } catch { return undefined; }
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
