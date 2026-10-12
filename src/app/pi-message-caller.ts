import { nativeSessionId } from '../modules/mailbox/public.js';
import { InputError } from '../shared/errors.js';
import { encodePiContext, MYPI_MCP_CONTEXT } from './pi-context.js';
import type { PiContextSelection } from './pi-context.js';

export const MYPI_MCP_NATIVE_SESSION_ID = 'MYPI_MCP_NATIVE_SESSION_ID';
/** Escaping for Pi MCP env interpolation only, not identity authentication. */
export function encodeNativeCaller(id: string): string {
  nativeSessionId(id);
  const bytes = Buffer.from(id, 'utf8');
  if (bytes.toString('utf8') !== id) throw new InputError('Invalid native caller ID');
  return bytes.toString('base64url');
}
export function decodeNativeCaller(envelope: string | undefined): string | undefined {
  if (envelope === undefined || envelope === '') return undefined;
  try {
    if (envelope.length > 1366 || !/^[A-Za-z0-9_-]+$/.test(envelope)) throw new Error();
    const bytes = Buffer.from(envelope, 'base64url');
    if (bytes.toString('base64url') !== envelope) throw new Error();
    const id = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    nativeSessionId(id);
    return id;
  } catch { throw new InputError('Invalid native caller envelope'); }
}
export function nativeCallerEnvironment(selection: PiContextSelection, id: string | undefined) {
  return {
    [MYPI_MCP_CONTEXT]: selection.state === 'selected' ? encodePiContext(selection.data) : '',
    [MYPI_MCP_NATIVE_SESSION_ID]: id === undefined ? '' : encodeNativeCaller(id),
  };
}
export function sameNativeCaller(a: ReturnType<typeof nativeCallerEnvironment> | undefined, b: ReturnType<typeof nativeCallerEnvironment>): boolean {
  return a?.[MYPI_MCP_CONTEXT] === b[MYPI_MCP_CONTEXT] && a?.[MYPI_MCP_NATIVE_SESSION_ID] === b[MYPI_MCP_NATIVE_SESSION_ID];
}
