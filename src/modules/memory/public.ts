import { InputError } from '../../shared/errors.js';
interface Files {
  read(path: string): string | undefined;
  edit(path: string, update: (old: string | undefined) => string): void;
}
function items(text: string): { line: number; text: string }[] {
  return text.split('\n').flatMap((line, index) => {
    if (line.startsWith('- "')) {
      const value: unknown = JSON.parse(line.slice(2));
      if (typeof value !== 'string') throw new InputError('Corrupt memory fact');
      return [{ line: index, text: value }];
    }
    return [];
  });
}
export function factLines(text: string): number[] { return items(text).map(item => item.line); }
export function createMemory(files: Files, revision: (text: string) => string) {
  function path(base: string): string { return (base ? base + '/' : '') + 'MEMORY.md'; }
  return {
    show(base: string) {
      const text = files.read(path(base)) ?? '';
      return { path: path(base), text, revision: revision(text), items: items(text).map((item, i) => ({ number: i + 1, text: item.text })) };
    },
    add(base: string, text: string) {
      if (!text.trim()) throw new InputError('Nonempty fact required');
      files.edit(path(base), old => {
        if (old !== undefined) items(old);
        const prefix = old ?? '# Memory\n\n';
        return prefix + (prefix.endsWith('\n') ? '' : '\n') + '- ' + JSON.stringify(text) + '\n';
      });
      return path(base);
    },
    remove(base: string, number: number, expectedRevision: string) {
      let removed = '';
      files.edit(path(base), old => {
        if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)
          || revision(old ?? '') !== expectedRevision)
          throw new InputError('Memory revision missing or stale; reread memory_show');
        const fact = items(old ?? '')[number - 1];
        if (!Number.isSafeInteger(number) || number < 1 || !fact) throw new InputError('Unknown fact number; reread memory_show');
        removed = fact.text;
        return old!.split('\n').filter((_, i) => i !== fact.line).join('\n');
      });
      return removed;
    },
  };
}
