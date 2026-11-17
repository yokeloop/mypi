export type Agent = 'claude' | 'pi';
export interface SessionScope { scopeType: 'global' | 'org' | 'project' | 'task'; orgId: number | null; projectId: number | null; taskId: number | null }
export interface SessionRow extends SessionScope {
  id: number; key: string; agent: Agent; nativeId: string; device: string; createdAt: string; activeAt: string | null; endedAt: string | null;
}
export type NewSession = SessionScope & { key: string; agent: Agent; nativeId: string; device: string; createdAt: string };
export interface SessionStore {
  transaction<T>(fn: () => T): T;
  active(key: string): SessionRow | undefined;
  rows(key: string): SessionRow[];
  byNative(agent: Agent, nativeId: string): SessionRow | undefined;
  save(row: NewSession): number;
  touch(id: number, at: string): void;
  renew(id: number, at: string): void;
  removeKey(key: string): number;
  list(): SessionRow[];
}
export interface RegistryRecord {
  key: string; agent: Agent; nativeId: string; pid: number; start: string;
  name: string | null; socket: string | null; permissionMode: string | null;
  registeredAt: string; herdrName?: string;
}
export interface Registry {
  start(pid: number): string | undefined;
  permissionMode(pid: number): string | null;
  live(prune?: boolean): RegistryRecord[];
  write(record: RegistryRecord): void;
  remove(record: RegistryRecord): void;
}
