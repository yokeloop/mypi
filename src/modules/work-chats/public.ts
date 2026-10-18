import { InputError } from '../../shared/errors.js';
export { assertBinding, assertNative } from './chat.js';
export type { ChatBinding, ChatStore, NativeIdentity, ProcessIdentity, WorkChat } from './chat.js';

export interface ModelPair { provider: string; model: string }
export type ModelSource = 'invocation' | 'saved session' | 'project' | 'organization' | 'default';
export interface ModelSelection extends ModelPair { source: ModelSource }
export interface ModelDefaults {
  default?: ModelPair;
  organizations?: Record<string, ModelPair>;
  projects?: Record<string, ModelPair>;
}
export type SavedModel =
  | { status: 'selected'; selection: ModelPair }
  | { status: 'none' }
  | { status: 'unavailable'; reason: string };

function object(value: unknown, location: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError(`${location} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: readonly string[], location: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new InputError(`${location}: unknown field ${key}`);
  }
}

export function validateModelPair(value: unknown, location: string): ModelPair {
  const pair = object(value, location);
  fields(pair, ['provider', 'model'], location);
  for (const key of ['provider', 'model'] as const) {
    if (typeof pair[key] !== 'string' || pair[key].trim() !== pair[key] || !pair[key].trim()
      || pair[key].includes('\0') || (key === 'provider' && pair[key].includes('/'))) {
      throw new InputError(`${location}.${key} must be a nonempty exact ${key} ID`);
    }
  }
  return { provider: pair.provider as string, model: pair.model as string };
}

/** Validate every configured identity, including entries unrelated to the current chat. */
export function parseModelDefaults(
  value: unknown,
  registered: { organization(slug: string): boolean; project(identity: string): boolean },
): ModelDefaults {
  const config = object(value, 'work-chats.json');
  fields(config, ['default', 'organizations', 'projects'], 'work-chats.json');
  const result: ModelDefaults = {};
  if ('default' in config) result.default = validateModelPair(config.default, 'default');
  if ('organizations' in config) {
    result.organizations = {};
    for (const [slug, pair] of Object.entries(object(config.organizations, 'organizations'))) {
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(slug) || !registered.organization(slug)) {
        throw new InputError(`organizations.${slug}: unknown registered organization`);
      }
      result.organizations[slug] = validateModelPair(pair, `organizations.${slug}`);
    }
  }
  if ('projects' in config) {
    result.projects = {};
    for (const [identity, pair] of Object.entries(object(config.projects, 'projects'))) {
      const segments = identity.split('/');
      if (segments.length !== 2 || !segments.every(s => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(s))
        || !registered.project(identity)) {
        throw new InputError(`projects.${identity}: unknown registered project`);
      }
      result.projects[identity] = validateModelPair(pair, `projects.${identity}`);
    }
  }
  return result;
}

/** With --provider the model is verbatim; otherwise split only at the first slash. */
export function parseModelInvocation(input: { provider?: string; model?: string }): ModelPair | undefined {
  if (input.provider === undefined && input.model === undefined) return undefined;
  if (input.model === undefined) throw new InputError('--provider requires --model');
  if (input.provider !== undefined) return validateModelPair(input, 'invocation');
  const slash = input.model.indexOf('/');
  if (slash < 0) throw new InputError('--model requires provider/model-id or a separate --provider');
  return validateModelPair({ provider: input.model.slice(0, slash), model: input.model.slice(slash + 1) }, 'invocation');
}

export function resolveModelSelection(input: {
  identity: string;
  invocation?: ModelPair;
  saved?: SavedModel;
  readDefaults: () => ModelDefaults;
}): ModelSelection {
  if (input.saved?.status === 'unavailable') throw new InputError(`Native session model unavailable: ${input.saved.reason}`);
  if (input.invocation !== undefined) return { ...validateModelPair(input.invocation, 'invocation'), source: 'invocation' };
  if (input.saved?.status === 'selected') {
    return { ...validateModelPair(input.saved.selection, 'saved session'), source: 'saved session' };
  }
  const config = input.readDefaults();
  const org = input.identity.split('/')[0]!;
  const levels: [ModelSource, ModelPair | undefined][] = [
    ['project', config.projects?.[input.identity]],
    ['organization', config.organizations?.[org]],
    ['default', config.default],
  ];
  for (const [source, pair] of levels) if (pair) return { ...pair, source };
  throw new InputError(`No model selected for ${input.identity}; set home/pi/work-chats.json or specify a complete model pair`);
}

/** Compare the entire resolved selection at execution, not just its model ID. */
export function sameModelSelection(a: ModelSelection, b: ModelSelection): boolean {
  return a.provider === b.provider && a.model === b.model && a.source === b.source;
}
