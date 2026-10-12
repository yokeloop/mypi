import { dirname, join } from 'node:path';
import type { BrowseResult } from '../app/setup-observation.js';

export type PickerKind = 'directory' | 'file' | 'future-directory' | 'future-file';
export interface Picker { path: string; kind: PickerKind; query: string; offset: number; selection: number; page: BrowseResult }
export type PickerItem = { label: string; action: 'use' | 'parent' | 'home' | 'engine' | 'child' | 'manual' | 'back' | 'entry' | 'next' | 'previous'; path?: string; error?: string };
export function pickerItems(picker: Picker, userHome: string, engine: string): PickerItem[] {
  const { page, kind } = picker;
  return [
    { label: kind === 'file' ? 'Выберите файл ниже' : 'Использовать эту папку: ' + picker.path, action: 'use' },
    { label: 'Родительская папка: ' + dirname(picker.path), action: 'parent', path: dirname(picker.path) },
    { label: 'Домашняя папка: ' + userHome, action: 'home', path: userHome },
    { label: 'Checkout: ' + engine, action: 'engine', path: engine },
    ...(kind.startsWith('future') ? [{ label: 'Новая папка или файл здесь…', action: 'child' as const }] : []),
    { label: 'Ввести путь…', action: 'manual' },
    { label: 'Назад', action: 'back' },
    ...(picker.offset ? [{ label: '← Предыдущие', action: 'previous' as const }] : []),
    ...page.entries.map(entry => ({ label: `${entry.kind === 'link' ? '↪' : entry.kind === 'directory' ? '▸' : '•'} ${entry.name}${entry.error ? ' — ' + entry.error : ''}`,
      action: 'entry' as const, path: entry.path, ...(entry.error ? { error: entry.error } : {}) })),
    ...(page.nextOffset !== undefined ? [{ label: 'Следующие →', action: 'next' as const }] : []),
  ];
}
export function entryIsDirectory(entry: BrowseResult['entries'][number]): boolean {
  return entry.kind === 'directory' || entry.kind === 'link' && entry.targetKind === 'directory';
}
export function pickerDestination(picker: Picker, name: string): string { return join(picker.path, name); }
