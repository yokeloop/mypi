/** One open-file-description lock, also inherited by participating Git processes. */
export interface HomeLock {
  readonly descriptor: number;
  close(): void;
}
