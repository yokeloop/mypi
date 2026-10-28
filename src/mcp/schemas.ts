import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { scopeValue } from '../shared/scope.js';
import type { AppCommand } from '../app/commands.js';

export const text = z.string();
export const externalPath = text.refine(p => isAbsolute(p) && !p.includes('\0'), 'Absolute path without NUL required');
const globalScope = z.strictObject({ type: z.literal('global') });
const keyedScope = z.strictObject({ type: z.enum(['org', 'project', 'task']), key: text });
export const scope = z.union([globalScope, keyedScope]).refine(value => {
  try { scopeValue(value); return true; } catch { return false; }
}, 'Invalid scope');
export const contextScope = scope.refine(value => value.type !== 'task', 'Context scope cannot be task');
export const textInput = z.union([z.strictObject({ text }), z.strictObject({ file: externalPath })]);
export const artifact = z.strictObject({ path: text, text: text.optional() });
// The envelope is stable; data retains the existing operation-specific CLI JSON.
export const output = z.strictObject({
  status: z.enum(['ok', 'error', 'partial']), data: z.unknown().optional(),
  message: text.optional(), saved: z.array(text).optional(), missing: z.array(text).optional(),
  paths: z.array(text).optional(), taskId: z.number().int().positive().optional(),
});

export function tool<S extends z.ZodType>(schema: S, description: string, translate: (args: z.infer<S>) => AppCommand[]) {
  return { schema, description, command: (args: unknown) => translate(schema.parse(args)) };
}
type Rules = Record<string, { required: string[]; optional?: string[] }>;
type ActionShape<K extends string, R extends Rules, S extends z.ZodRawShape> =
  { [P in K]: z.ZodEnum<{ [V in keyof R & string]: V }> } & { [P in keyof S]: z.ZodOptional<S[P]> };
export function actions<K extends string, R extends Rules, S extends z.ZodRawShape>(key: K, rules: R, shape: S) {
  const fields = Object.fromEntries(Object.entries(shape).map(([field, schema]) => [field, z.optional(schema)]));
  const schema = z.strictObject({ [key]: z.enum(Object.keys(rules) as [string, ...string[]]), ...fields }) as unknown as
    z.ZodObject<ActionShape<K, R, S>, z.core.$strict>;
  return schema.superRefine((value, ctx) => {
    const record = value as Record<string, unknown>, selected = record[key] as string, rule = rules[selected]!;
    for (const field of rule.required) if (record[field] === undefined)
      ctx.addIssue({ code: 'custom', path: [field], message: field + ' is required for ' + key + ' ' + selected });
    for (const field of Object.keys(shape)) if (record[field] !== undefined && !rule.required.includes(field) && !rule.optional?.includes(field))
      ctx.addIssue({ code: 'custom', path: [field], message: field + ' is not allowed for ' + key + ' ' + selected });
  });
}
