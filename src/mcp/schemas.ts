import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { scopeValue } from '../shared/scope.js';

export const text = z.string();
export const externalPath = text.refine(p => isAbsolute(p) && !p.includes('\0'), 'Absolute path without NUL required');
const globalScope = z.strictObject({ type: z.literal('global') });
const keyedScope = z.strictObject({ type: z.enum(['org', 'project', 'request']), key: text });
export const scope = z.union([globalScope, keyedScope]).refine(value => {
  try { scopeValue(value); return true; } catch { return false; }
}, 'Invalid scope');
export const contextScope = scope.refine(value => value.type !== 'request', 'Context scope cannot be request');
export const textInput = z.union([z.strictObject({ text }), z.strictObject({ file: externalPath })]);
export const artifact = z.strictObject({ path: text, text: text.optional() });
// The envelope is stable; data retains the existing operation-specific CLI JSON.
export const output = z.strictObject({
  status: z.enum(['ok', 'error', 'partial']), data: z.unknown().optional(),
  message: text.optional(), saved: z.array(text).optional(), missing: z.array(text).optional(),
  paths: z.array(text).optional(), requestId: z.number().int().positive().optional(),
});
