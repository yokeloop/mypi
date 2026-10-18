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
export function exactCatalogModel(output: string, pair: ModelPair): boolean {
  const lines = output.trimEnd().split('\n');
  if (lines.length < 2 || !/^provider\s{2,}model\s{2,}context\s{2,}max-out\s{2,}thinking\s{2,}images\s*$/.test(lines[0]!)) throw new InputError('Unsupported or empty Pi model catalog');
  let matches = 0;
  for (const line of lines.slice(1)) {
    const columns = line.trimEnd().split(/ {2,}/);
    if (columns.length !== 6 || !/^\d+(?:\.\d+)?[KM]?$/.test(columns[2]!) || !/^\d+(?:\.\d+)?[KM]?$/.test(columns[3]!)
      || !['yes', 'no'].includes(columns[4]!) || !['yes', 'no'].includes(columns[5]!)) throw new InputError('Malformed Pi model catalog row');
    if (columns[0] === pair.provider && columns[1] === pair.model) matches++;
  }
  if (matches > 1) throw new InputError('Ambiguous target Pi model catalog');
  return matches === 1;
}
export function readyAuth(output: string, provider: string): boolean {
  const response = json(output);
  return response.status === 'ready' && response.provider === provider && typeof response.authType === 'string' && !!response.authType;
}

export function finalEmptySnapshot(header: { id: string; cwd: string } | null,
  entries: readonly { type: string; message?: { role?: string } }[], sessionId: string, cwd: string): boolean {
  return header?.id === sessionId && header.cwd === cwd
    && entries.every(entry => entry.type === 'model_change' || entry.type === 'thinking_level_change');
}

export function emptyContinuity(previous: { continuous?: boolean; sessionId?: unknown; historyPath?: unknown;
  processId?: unknown; lifecycle?: unknown; everPersisted?: unknown } | undefined,
  current: { lifecycle?: unknown; sessionId?: unknown; historyPath?: unknown; processId?: unknown;
    fileExists?: unknown; finalEmpty?: unknown; error?: unknown }): { continuous: boolean; everPersisted: boolean; provenEmpty: boolean } {
  const continuous = !previous ? current.lifecycle === 'start:startup'
    : previous.continuous === true && previous.sessionId === current.sessionId
      && previous.historyPath === current.historyPath && previous.processId === current.processId
      && !['shutdown:quit', 'shutdown:new', 'shutdown:resume', 'shutdown:fork'].includes(String(previous.lifecycle));
  const everPersisted = previous?.everPersisted === true || current.fileExists === true;
  return { continuous, everPersisted, provenEmpty: current.lifecycle === 'shutdown:quit' && continuous
    && !everPersisted && current.finalEmpty === true && !current.error && current.fileExists === false };
}

export function startupReceipt(receipt: { lifecycle: string; error?: string; processId: number; scope: string; model: ModelPair; fileExists: boolean },
  expected: { processId: number; scope: string; model: ModelPair }): boolean {
  return receipt.lifecycle === 'start:startup' && !receipt.error
    && receipt.processId === expected.processId && receipt.scope === expected.scope
    && receipt.model?.provider === expected.model.provider && receipt.model.model === expected.model.model;
}

// Native JSONL v3 is a branching tree: follow parent IDs from the last leaf,
// not the last model_change in file order (which can belong to another branch).
export function nativeHistory(text: string, sessionId: string, cwd: string,
  binding?: { installation: string; state: string; scope: string }): SavedModel {
  const lines = text.trimEnd().split('\n').map(json);
  const header = lines.shift();
  if (!header || header.type !== 'session' || header.version !== 3 || header.id !== sessionId || header.cwd !== cwd) {
    throw new InputError('Native session header/branch unavailable or bound to another worktree');
  }
  const entries = new Map<string, Record<string, unknown>>();
  for (const entry of lines) {
    const key = id(entry.id);
    if (entries.has(key) || (entry.parentId !== null && typeof entry.parentId !== 'string')) throw new InputError('Invalid native session branch');
    entries.set(key, entry);
  }
  let current: string | null = lines.length ? id(lines.at(-1)!.id) : null;
  const seen = new Set<string>();
  let selection: ModelPair | undefined;
  let bound = false;
  while (current !== null) {
    if (seen.has(current)) throw new InputError('Cyclic native session branch');
    seen.add(current);
    const entry = entries.get(current);
    if (!entry) throw new InputError('Missing native session ancestor');
    if (entry.type === 'model_change' && !selection) selection = { provider: id(entry.provider), model: id(entry.modelId) };
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
  if (binding && !bound) throw new InputError('Native active branch has no matching scoped binding');
  return selection ? { status: 'selected', selection } : { status: 'none' };
}
