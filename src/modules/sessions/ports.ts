export type Agent = 'claude' | 'pi';
export interface SessionScope { scopeType: 'global' | 'project' | 'task'; projectId: number | null; taskId: number | null }
export interface SessionRow extends SessionScope { key: string; agent: Agent; nativeId: string; createdAt: string }
export interface SessionStore {
  transaction<T>(fn: () => T): T;
  get(key: string): SessionRow | undefined;
  byNative(agent: Agent, nativeId: string): SessionRow | undefined;
  save(row: SessionRow): void;
  remove(key: string): void;
  list(): SessionRow[];
}
export interface RegistryRecord {
  key: string; agent: Agent; nativeId: string; pid: number; start: string;
  name: string | null; socket: string | null; permissionMode: string | null;
  registeredAt: string; displacedAt?: string;
}
export interface Registry {
  start(pid: number): string | undefined;
  permissionMode(pid: number): string | null;
  live(prune?: boolean): RegistryRecord[];
  write(record: RegistryRecord): void;
  displace(record: RegistryRecord, at: string): RegistryRecord;
  remove(record: RegistryRecord): void;
}
