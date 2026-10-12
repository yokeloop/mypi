export type MypiCommand = { action: 'menu' | 'help' | 'open'; target?: string; worktree?: string; pickWorktree?: boolean };

type Completion = { value: string; label: string; description: string };
type Action = {
  name: 'open' | 'help'; description: string; usage: string;
  parse(args: string): MypiCommand;
  complete(prefix: string, targets: readonly string[]): Completion[];
};
function parseWorktreePath(raw: string): string {
  let value: string;
  if (/^"[^"]*"$/u.test(raw) || /^'[^']*'$/u.test(raw)) value = raw.slice(1, -1);
  else if (/^(?:\\[ \t]|[^\s\\'"\x00-\x1f\x7f])+$/u.test(raw)) value = raw.replace(/\\([ \t])/gu, '$1');
  else throw new Error('Malformed worktree path');
  if (!value.startsWith('/')) throw new Error('Worktree path must be absolute');
  return value;
}
export const mypiActions: readonly Action[] = [
  { name: 'open', description: 'Open an organization or project in a new Herdr tab',
    usage: 'open [org | org/project] [--worktree ["/absolute/path with spaces"]]',
    parse: raw => {
      if (!raw) return { action: 'open' };
      const match = /^(\S+?)(?:\s+--worktree(?:\s+([\s\S]*))?)?$/u.exec(raw);
      if (!match || match[1]!.startsWith('--')) throw new Error('Invalid open arguments');
      const target = match[1]!;
      if (match[2] !== undefined) {
        if (!target.includes('/')) throw new Error('Worktree requires a project');
        return { action: 'open', target, worktree: parseWorktreePath(match[2]) };
      }
      if (/\s+--worktree$/u.test(raw)) {
        if (!target.includes('/')) throw new Error('Worktree requires a project');
        return { action: 'open', target, pickWorktree: true };
      }
      return { action: 'open', target };
    },
    complete: (prefix, targets) => {
      const match = /^open\s+([^\s]*)$/.exec(prefix);
      if (!match) return [];
      return targets.filter(target => target.startsWith(match[1]!)).map(target => ({ value: `open ${target}`, label: target,
        description: target.includes('/') ? 'Registered project (base checkout)' : 'Registered organization' }));
    } },
  { name: 'help', description: 'Show mypi commands and examples', usage: 'help',
    parse: raw => { if (!raw) return { action: 'help' }; throw new Error('Help takes no arguments'); },
    complete: () => [] },
];

export function mypiHelp(): string {
  return ['mypi commands:', ...mypiActions.map(action => `  /mypi ${action.usage} — ${action.description}`),
    'Examples: /mypi open one  ·  /mypi open one/app  ·  /mypi open one/app --worktree  ·  /mypi open one/app --worktree "/path/with spaces"',
    'Without a target, open offers registered organizations and projects. Project opens use the registered base checkout by default.',
    'The optional worktree must already exist and be Git-confirmed. Quote paths with spaces or escape each space with backslash. Esc cancels without opening a tab.'].join('\n');
}
export function parseMypiCommand(args: string): MypiCommand {
  const input = args.trim();
  if (!input) return { action: 'menu' };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/u.exec(input);
  const action = mypiActions.find(item => item.name === match?.[1]);
  if (!action) throw new Error(`Invalid /mypi arguments.\n${mypiHelp()}`);
  try { return action.parse(match?.[2] ?? ''); }
  catch { throw new Error(`Invalid /mypi arguments.\n${mypiHelp()}`); }
}
export function mypiCompletions(prefix: string, targets: readonly string[] = []): Completion[] {
  if (!prefix.includes(' ') && prefix !== 'open') return mypiActions.filter(action => action.name.startsWith(prefix))
    .map(action => ({ value: action.name, label: action.name, description: action.description }));
  const action = mypiActions.find(item => prefix.startsWith(`${item.name} `));
  return action?.complete(prefix, targets) ?? [];
}

/** Identity/cwd-specific read-only snapshot; only explicit requests refresh a failed or stale result. */
export function createMypiRegistryCache(load: (cwd: string) => Promise<readonly string[]>, identity: string) {
  let snapshot: { key: string; targets: readonly string[] } | undefined;
  let failure: { key: string; message: string } | undefined;
  let pending: { key: string; token: object; promise: Promise<void> } | undefined;
  const key = (cwd: string) => JSON.stringify([identity, cwd]);
  return {
    targets(cwd: string): readonly string[] { return snapshot?.key === key(cwd) ? snapshot.targets : []; },
    failure(cwd: string): string | undefined { return failure?.key === key(cwd) ? failure.message : undefined; },
    warm(cwd: string): void {
      if (snapshot?.key === key(cwd) || failure?.key === key(cwd) || pending) return;
      void this.refresh(cwd);
    },
    async refresh(cwd: string): Promise<void> {
      const requested = key(cwd);
      if (pending?.key === requested) return pending.promise;
      snapshot = undefined; failure = undefined;
      const token = {};
      const promise = Promise.resolve().then(() => load(cwd))
        .then(targets => { if (pending?.token === token) snapshot = { key: requested, targets }; })
        .catch(cause => { if (pending?.token === token) failure = {
          key: requested, message: cause instanceof Error ? cause.message : String(cause) }; })
        .finally(() => { if (pending?.token === token) pending = undefined; });
      pending = { key: requested, token, promise };
      return promise;
    },
  };
}
