import { execFileSync } from 'node:child_process';
export function command(program: string, args: readonly string[], timeout = 10_000): string {
  return execFileSync(program, [...args], { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, SYSTEMD_PAGER: '', SYSTEMD_COLORS: '0', PAGER: 'cat' } }).trim();
}
export function shellQuote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
export function herdr(args: readonly string[]): Record<string, unknown> {
  if (process.env.HERDR_ENV !== '1') throw new Error('Herdr-managed caller required; no fallback');
  const output = command('herdr', args);
  // pane.run and some report commands acknowledge success with empty stdout.
  if (!output) return {};
  const reply = JSON.parse(output) as { result?: Record<string, unknown>; error?: unknown };
  if (reply.error || !reply.result) throw new Error('Herdr operation failed');
  return reply.result;
}
export function unitState(unit: string): Record<string, string> {
  const output = command('systemctl', ['--user', '--no-pager', 'show', unit, '-p', 'ActiveState', '-p', 'SubState', '-p', 'InvocationID', '-p', 'ControlGroup', '-p', 'MainPID']);
  return Object.fromEntries(output.split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
}
