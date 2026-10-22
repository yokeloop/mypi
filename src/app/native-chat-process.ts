import { readFileSync, realpathSync } from 'node:fs';
import { InputError } from '../shared/errors.js';
import { procStart } from './native-herdr-facts.js';
import type { NativeProcessSnapshot } from './native-herdr-facts.js';

export function linuxBootId(): string {
  const value = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  if (!/^[\da-f-]{36}$/.test(value)) throw new InputError('Linux boot identity unavailable');
  return value;
}
/** Only this recorded/foreground PID is read. Never enumerate /proc for writers. */
export function readNativeProcess(pid: number): NativeProcessSnapshot {
  const start = procStart(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  const value = { pid, start, boot: linuxBootId(), executable: realpathSync(`/proc/${pid}/exe`), cwd: realpathSync(`/proc/${pid}/cwd`),
    argv: readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean),
    env: Object.fromEntries(readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(pair => {
      const at = pair.indexOf('='); return [pair.slice(0, at), pair.slice(at + 1)];
    })) as Record<string, string> };
  if (procStart(readFileSync(`/proc/${pid}/stat`, 'utf8')) !== start) throw new InputError('Process changed during observation');
  return value;
}
