import { InputError } from '../../shared/errors.js';
interface Files { create(path: string, text: string): void }
export function createInbox(files: Files, name: () => string) {
  return {
    capture(source: string) {
      if (typeof source !== 'string' || !source.trim()) throw new InputError('Nonempty source required');
      const path = 'inbox/' + name() + '.md';
      files.create(path, source);
      return path;
    },
  };
}
