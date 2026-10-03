export interface Status { id: number; code: string; isTerminal: boolean }
export interface Card {
  id: number; projectId: number | null; number: number; title: string; statusId: number;
  status: string; isTerminal: boolean; contextDir: string; createdAt: string; updatedAt: string;
}
export interface RequestStore {
  transaction<T>(fn: () => T): T;
  statuses(): Status[];
  addStatus(code: string, terminal: boolean): void;
  renameStatus(code: string, next: string): void;
  terminalStatus(code: string, terminal: boolean): void;
  removeStatus(code: string): void;
  nextNumber(projectId: number | null): number;
  insert(input: Omit<Card, 'id' | 'status' | 'isTerminal'>): Card;
  list(): Card[];
  get(id: number): Card;
  update(id: number, title: string, statusId: number, at: string): Card;
}
