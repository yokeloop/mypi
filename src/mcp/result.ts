import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PartialError } from '../shared/context.js';

function result(value: Record<string, unknown>, isError = false): CallToolResult {
  return { ...(isError ? { isError: true } : {}), structuredContent: value,
    content: [{ type: 'text', text: JSON.stringify(value) }] };
}
export function success(data: unknown): CallToolResult { return result({ status: 'ok', data }); }
export function failure(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return result(error instanceof PartialError ? {
    status: 'partial', message, saved: error.saved, missing: error.missing, paths: error.paths,
    ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    ...(error.home === undefined ? {} : { home: error.home }),
  } : { status: 'error', message }, true);
}
