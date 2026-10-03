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
    const legacy = /^- \(\d{4}-\d\d-\d\d\) (.*)$/.exec(line);
    return legacy ? [{ line: index, text: legacy[1]! }] : [];
  });
}
export function createMemory(files: Files) {
  function path(base: string): string { return (base ? base + '/' : '') + 'MEMORY.md'; }
  return {
    show(base: string) {
      const text = files.read(path(base)) ?? '';
      return { path: path(base), text, items: items(text).map((item, i) => ({ number: i + 1, text: item.text })) };
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
    remove(base: string, number: number) {
      let removed = '';
      files.edit(path(base), old => {
        const fact = items(old ?? '')[number - 1];
        if (!Number.isSafeInteger(number) || number < 1 || !fact) throw new InputError('Unknown fact number');
        removed = fact.text;
        return old!.split('\n').filter((_, i) => i !== fact.line).join('\n');
      });
      return removed;
    },
  };
}
