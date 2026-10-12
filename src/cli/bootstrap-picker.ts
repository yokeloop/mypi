import { dirname, join } from 'node:path';
import type { BrowseResult } from '../app/setup-observation.js';

export type PickerKind = 'directory' | 'file' | 'future-directory' | 'future-file';
export interface Picker { path: string; kind: PickerKind; query: string; offset: number; selection: number; page: BrowseResult }
export type PickerItem = { label: string; action: 'use' | 'parent' | 'home' | 'engine' | 'child' | 'manual' | 'back' | 'entry' | 'next' | 'previous'; path?: string; error?: string };
export function pickerItems(picker: Picker, userHome: string, engine: string): PickerItem[] {
  const { page, kind } = picker;
  return [
    { label: kind === 'file' ? 'Select a file below' : 'Use this directory: ' + picker.path, action: 'use' },
    { label: 'Parent directory: ' + dirname(picker.path), action: 'parent', path: dirname(picker.path) },
    { label: 'Home directory: ' + userHome, action: 'home', path: userHome },
    { label: 'Checkout: ' + engine, action: 'engine', path: engine },
    ...(kind.startsWith('future') ? [{ label: 'New directory or file here…', action: 'child' as const }] : []),
    { label: 'Enter path…', action: 'manual' },
    { label: 'Back', action: 'back' },
    ...(picker.offset ? [{ label: '← Previous', action: 'previous' as const }] : []),
    ...page.entries.map(entry => ({ label: `${entry.kind === 'link' ? '↪' : entry.kind === 'directory' ? '▸' : '•'} ${entry.name}${entry.error ? ' — ' + entry.error : ''}`,
      action: 'entry' as const, path: entry.path, ...(entry.error ? { error: entry.error } : {}) })),
    ...(page.nextOffset !== undefined ? [{ label: 'Next →', action: 'next' as const }] : []),
  ];
}
export function entryIsDirectory(entry: BrowseResult['entries'][number]): boolean {
  return entry.kind === 'directory' || entry.kind === 'link' && entry.targetKind === 'directory';
}
export function pickerDestination(picker: Picker, name: string): string { return join(picker.path, name); }
