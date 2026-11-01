import { InputError } from '../../shared/errors.js';

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface ProjectFlow {
  integration?: string;
  taskBranch?: string;
  prTarget?: string;
  mergeMethod?: MergeMethod;
  release?: string;
}

export const DEFAULT_TASK_BRANCH = 'task/{KEY}-{slug}';

const fields = ['integration', 'taskBranch', 'prTarget', 'mergeMethod', 'release'];
const mergeMethods: readonly string[] = ['merge', 'squash', 'rebase'];

export function validBranchName(name: string): boolean {
  if (name === '' || name === '@' || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name) || name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  return name.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock'));
}

export function taskBranchName(template: string, key: string, slug: string): string {
  return template.replaceAll('{KEY}', key).replaceAll('{slug}', slug);
}

function validRelease(value: string): boolean {
  if (value.trim() === '' || /[\x00-\x1f\x7f]/.test(value) || value.startsWith('/') || value.split('/').includes('..')) return false;
  if (!value.includes('://')) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function parseFlow(text: string, file: string): ProjectFlow {
  const fail = (message: string) => new InputError('Invalid flow ' + file + ': ' + message);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw fail('not valid JSON'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fail('must be a JSON object');
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find(key => !fields.includes(key));
  if (unknown !== undefined) throw fail('unknown field ' + unknown);
  const flow: ProjectFlow = {};
  for (const field of ['integration', 'prTarget'] as const) {
    if (!Object.hasOwn(input, field)) continue;
    const branch = input[field];
    if (typeof branch !== 'string' || !validBranchName(branch)) throw fail(field + ' must be a valid branch name');
    flow[field] = branch;
  }
  if (Object.hasOwn(input, 'taskBranch')) {
    const template = input.taskBranch;
    if (typeof template !== 'string') throw fail('taskBranch must be a string');
    if (!template.includes('{KEY}')) throw fail('taskBranch must contain {KEY}');
    if (/[{}]/.test(template.replaceAll('{KEY}', '').replaceAll('{slug}', ''))) {
      throw fail('taskBranch may use only the placeholders {KEY} and {slug}');
    }
    if (!validBranchName(taskBranchName(template, 'MP-1', 'task-slug')) || !validBranchName(taskBranchName(template, 'ABC-999', 'x'))) {
      throw fail('taskBranch must give a valid branch name');
    }
    flow.taskBranch = template;
  }
  if (Object.hasOwn(input, 'mergeMethod')) {
    const method = input.mergeMethod;
    if (typeof method !== 'string' || !mergeMethods.includes(method)) throw fail('mergeMethod must be merge, squash or rebase');
    flow.mergeMethod = method as MergeMethod;
  }
  if (Object.hasOwn(input, 'release')) {
    const release = input.release;
    if (typeof release !== 'string' || !validRelease(release)) {
      throw fail('release must be an https URL or a path relative to the project\'s clone');
    }
    flow.release = release;
  }
  return flow;
}
