import { readFileSync } from 'node:fs';
import type { TextInput } from './commands.js';
import { InputError } from '../shared/errors.js';

export function readInputFile(path: string): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
}
export function inputText(input: TextInput): string {
  if (typeof input.text === 'string' && input.file === undefined) return input.text;
  if (typeof input.file === 'string' && input.text === undefined) return readInputFile(input.file);
  throw new InputError('Exactly one of text or file required');
}
