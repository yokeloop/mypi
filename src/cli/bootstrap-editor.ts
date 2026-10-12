export interface Editor { text: string; cursor: number }
const points = (text: string) => Array.from(text);
export function insert(editor: Editor, text: string): Editor {
  const characters = points(editor.text), added = points(text);
  characters.splice(editor.cursor, 0, ...added);
  return { text: characters.join(''), cursor: editor.cursor + added.length };
}
export function editKey(editor: Editor, key: 'left' | 'right' | 'home' | 'end' | 'backspace' | 'delete'): Editor {
  const characters = points(editor.text), cursor = editor.cursor;
  if (key === 'left') return { ...editor, cursor: Math.max(0, cursor - 1) };
  if (key === 'right') return { ...editor, cursor: Math.min(characters.length, cursor + 1) };
  if (key === 'home') return { ...editor, cursor: 0 };
  if (key === 'end') return { ...editor, cursor: characters.length };
  if (key === 'backspace' && cursor > 0) { characters.splice(cursor - 1, 1); return { text: characters.join(''), cursor: cursor - 1 }; }
  if (key === 'delete') characters.splice(cursor, 1);
  return { text: characters.join(''), cursor };
}
export function complete(editor: Editor, candidates: string[]): { editor: Editor; matches: string[] } {
  const before = points(editor.text).slice(0, editor.cursor).join('');
  const slash = before.lastIndexOf('/'), prefix = before.slice(slash + 1);
  const matches = candidates.filter(name => name.startsWith(prefix));
  if (matches.length !== 1) return { editor, matches };
  const after = points(editor.text).slice(editor.cursor).join('');
  const text = before.slice(0, slash + 1) + matches[0] + after;
  return { editor: { text, cursor: points(before.slice(0, slash + 1) + matches[0]!).length }, matches };
}
export function displayEditor(editor: Editor): string {
  const pointsText = points(editor.text);
  pointsText.splice(editor.cursor, 0, '▏');
  return pointsText.join('');
}
