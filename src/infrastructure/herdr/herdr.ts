import { spawnSync } from 'node:child_process';

export class HerdrError extends Error {
  override name = 'HerdrError';
  constructor(message: string, readonly code: string) { super(message); }
}

export interface HerdrWorkspace { workspaceId: string; label: string; focused: boolean }

function parse(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

function call(args: string[], timeout: number): unknown {
  const result = spawnSync('herdr', args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') throw new HerdrError('herdr is not installed or not on PATH', 'unavailable');
  if (result.error) throw new HerdrError(result.error.message, 'failed');
  const output = parse(result.stdout) ?? parse(result.stderr);
  const error = (output as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  if (output !== null && typeof output === 'object' && error !== undefined) {
    throw new HerdrError(String(error.message), error.code === 'server_not_running' ? 'unavailable' : String(error.code));
  }
  if (result.status !== 0 && output === undefined) throw new HerdrError(result.stderr.trim() || 'herdr failed', 'failed');
  return output;
}

function text(value: unknown, args: string[]): string {
  if (typeof value !== 'string') throw new HerdrError('Unexpected herdr output for ' + args[0] + ' ' + args[1], 'failed');
  return value;
}

export function herdrCli() {
  return {
    workspaces(): HerdrWorkspace[] {
      const args = ['workspace', 'list'];
      const list = (call(args, 10_000) as { result?: { workspaces?: unknown } } | undefined)?.result?.workspaces;
      if (!Array.isArray(list)) throw new HerdrError('Unexpected herdr output for workspace list', 'failed');
      return list.map((w: { workspace_id?: unknown; label?: unknown; focused?: unknown }) =>
        ({ workspaceId: text(w.workspace_id, args), label: text(w.label, args), focused: w.focused === true }));
    },
    createWorkspace(cwd: string, label: string): string {
      const args = ['workspace', 'create', '--cwd', cwd, '--label', label, '--no-focus'];
      return text((call(args, 10_000) as { result?: { workspace?: { workspace_id?: unknown } } } | undefined)?.result?.workspace?.workspace_id, args);
    },
    createTab(input: { workspaceId: string; cwd: string; label: string; env: Record<string, string> }): { tabId: string; paneId: string } {
      const args = ['tab', 'create', '--workspace', input.workspaceId, '--cwd', input.cwd, '--label', input.label,
        ...Object.entries(input.env).flatMap(([k, v]) => ['--env', k + '=' + v]), '--no-focus'];
      const result = (call(args, 10_000) as { result?: { tab?: { tab_id?: unknown }; root_pane?: { pane_id?: unknown } } } | undefined)?.result;
      return { tabId: text(result?.tab?.tab_id, args), paneId: text(result?.root_pane?.pane_id, args) };
    },
    startAgent(name: string, kind: 'claude' | 'pi', paneId: string, args: string[]): void {
      call(['agent', 'start', name, '--kind', kind, '--pane', paneId, '--', ...args], 45_000);
    },
    focusAgent(name: string): void {
      call(['agent', 'focus', name], 10_000);
    },
  };
}
