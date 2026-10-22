import { InputError } from '../shared/errors.js';
import type { ModelPair, SavedModel } from '../modules/work-chats/public.js';
function json(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('Malformed native observation');
  return parsed as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new InputError('Missing native identity');
  return value;
}
// Native JSONL v3 is a branching tree: follow parent IDs from the last leaf,
// not the last model_change in file order (which can belong to another branch).
export interface NativeHistoryFacts { saved: SavedModel; entryIds: ReadonlySet<string>; modelEntryId?: string }
export function nativeHistory(text: string, sessionId: string, cwd: string,
  binding?: { installation: string; state: string; scope: string }): SavedModel {
  return nativeHistoryFacts(text, sessionId, cwd, binding).saved;
}
export function nativeHistoryFacts(text: string, sessionId: string, cwd: string,
  binding?: { installation: string; state: string; scope: string }): NativeHistoryFacts {
  const lines = text.trimEnd().split('\n').map(json);
  const header = lines.shift();
  if (!header || header.type !== 'session' || header.version !== 3 || header.id !== sessionId || header.cwd !== cwd) {
    throw new InputError('Native session header/branch unavailable or bound to another worktree');
  }
  const entries = new Map<string, Record<string, unknown>>();
  for (const entry of lines) {
    const key = id(entry.id);
    if (typeof entry.type !== 'string' || entry.type === 'session' || entries.has(key)
      || (entry.parentId !== null && (typeof entry.parentId !== 'string' || !entries.has(entry.parentId)))) throw new InputError('Invalid native session branch');
    entries.set(key, entry);
  }
  let current: string | null = lines.length ? id(lines.at(-1)!.id) : null;
  const seen = new Set<string>();
  let selection: ModelPair | undefined, modelEntryId: string | undefined;
  let bound = false;
  while (current !== null) {
    if (seen.has(current)) throw new InputError('Cyclic native session branch');
    seen.add(current);
    const entry = entries.get(current);
    if (!entry) throw new InputError('Missing native session ancestor');
    if (entry.type === 'model_change' && !selection) {
      selection = { provider: id(entry.provider), model: id(entry.modelId) }; modelEntryId = current;
    }
    if (entry.type === 'custom' && entry.customType === 'mypi-startup-binding' && !bound && binding) {
      if (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) throw new InputError('Invalid native scoped binding');
      const data = entry.data as Record<string, unknown>;
      if (data.installation !== binding.installation || data.state !== binding.state || data.scope !== binding.scope) {
        throw new InputError('Native active branch has another installation/state/scope');
      }
      bound = true;
    }
    current = entry.parentId as string | null;
  }
  return { saved: selection ? { status: 'selected', selection } : { status: 'none' }, entryIds: new Set(entries.keys()),
    ...(modelEntryId ? { modelEntryId } : {}) };
}
