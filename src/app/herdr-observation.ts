import { isAbsolute, normalize } from 'node:path';

export interface HerdrObservation {
  herdrSocketPath: string;
  herdrPaneId: string;
  herdrTabId: string;
}
export function herdrId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && !value.startsWith('-') && !/[\x00-\x20\x7f]/.test(value);
}
export function herdrSocket(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && isAbsolute(value)
    && normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value);
}
/** Inherited hints only; an explicit control operation must verify the caller and target. */
export function observeHerdr(env: Readonly<Record<string, string | undefined>>): HerdrObservation | undefined {
  const socket = env['HERDR_SOCKET_PATH'], pane = env['HERDR_PANE_ID'], tab = env['HERDR_TAB_ID'];
  if (env['HERDR_ENV'] !== '1' || !herdrSocket(socket) || !herdrId(pane) || !herdrId(tab)
    || !herdrId(env['HERDR_WORKSPACE_ID'])) return;
  return { herdrSocketPath: socket, herdrPaneId: pane, herdrTabId: tab };
}
