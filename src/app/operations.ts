import type { AppCommand, OperationName } from './commands.js';

export type { OperationName };
export type OperationInput<K extends AppCommand['name']> = Omit<Extract<AppCommand, { name: K }>, 'name'>;
export type OperationTarget = { filename: string; root?: string; trustedPaths?: boolean };

export function runOperation<K extends OperationName>(_t: OperationTarget, _name: K, _input: OperationInput<K>): unknown {
  throw new Error('Not implemented');
}
