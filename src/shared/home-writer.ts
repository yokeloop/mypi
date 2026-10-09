export interface HomePending {
  id: string;
  operation: string;
  paths: string[];
  beforeHead: string;
  phase: 'mutating' | 'committed' | 'publishing';
  commit?: string;
  destinationId: string;
}
export interface HomeStatus {
  head: string | null;
  pending: HomePending | null;
  remoteHead: string | null;
  remoteOutcome: 'matches-local' | 'different' | 'missing' | 'unknown';
  needsAttention: boolean;
}
export interface HomeRecovery extends HomeStatus {
  needsAttention: true;
  pending: HomePending;
}
export interface HomeDeclaration {
  path: string;
  /** SHA256 of exact bytes, or null for an absent file. */
  expected: string | null;
  adopt?: true;
}
/** Only synchronous application operations with known SQLite transaction boundaries. */
export interface HomeWriteScope {
  readonly descriptor: number;
  preimage(path: string): string | null;
  declare(paths: HomeDeclaration[]): void;
  beforeEffect(): void;
  databaseSaved(requestId: number): void;
  committed(commit: string): void;
}
