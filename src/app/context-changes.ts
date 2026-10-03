import { PartialError } from '../shared/context.js';
import type { ContextHistory } from '../shared/context.js';

// Caller serializes cooperating writers; no retry, operation records or rollback fiction.
export function changeContext(history: ContextHistory, paths: string[], save: () => void, message: string): string {
  history.clean(paths);
  let saved = false;
  try {
    save();
    saved = true;
    return history.commit(paths, message);
  } catch (error) {
    throw new PartialError(String(error), saved ? ['context'] : [],
      saved ? ['git'] : ['inspect context', 'git'], paths);
  }
}
