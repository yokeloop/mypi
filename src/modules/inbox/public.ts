import { InputError } from '../../shared/errors.js';
interface Files { create(path: string, text: string): void; read(path: string): string | undefined; list(path: string): string[] }
export function createInbox(files: Files, name: () => string) {
  return {
    capture(source: string) {
      if (typeof source !== 'string' || !source.trim()) throw new InputError('Nonempty source required');
      const path = 'inbox/' + name() + '.md';
      files.create(path, source);
      return path;
    },
    index() {
      return files.list('inbox').map(file => {
        const path = 'inbox/' + file;
        const text = files.read(path);
        if (text === undefined) throw new InputError('Missing inbox source');
        return { path, preview: text.slice(0, 160) };
      });
    },
  };
}
