import { InputError } from '../../shared/errors.js';
interface Files { create(path: string, text: string): void; edit(path: string, update: (old: string | undefined) => string): void }
export function createNotes(files: Files, name: () => string, clock: () => string) {
  return {
    note(base: string, title: string, text: string) {
      if (!title.trim() || !text.trim()) throw new InputError('Nonempty title/text required');
      const path = (base ? base + '/' : '') + 'notes/' + name() + '.md';
      files.create(path, '# ' + title + '\n\n' + text);
      return path;
    },
    error(base: string, text: string) {
      if (!text.trim()) throw new InputError('Nonempty error required');
      const path = base + '/errors.md';
      files.edit(path, old => (old ?? '# Errors\n') + '\n- (' + clock() + ') ' + JSON.stringify(text) + '\n');
      return path;
    },
  };
}
