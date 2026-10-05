import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { DeriveGrant } from './derive-command.js';

export type DeriveConnector = () => Promise<{ call(request: { name: string; arguments: Record<string, unknown> }): Promise<Record<string, unknown>>; close(): Promise<void> }>;
export async function deriveSession(directory: string, grant: DeriveGrant, fixture: boolean, connect?: DeriveConnector) {
  if (!fixture && !connect) throw new Error('No Derive transport installed');
  let version = 1, body = 'fixture';
  const client = fixture ? {
    async call(request: { name: string; arguments: Record<string, unknown> }) {
      if (request.name === 'publish') {
        if (request.arguments.base_version !== version) throw new Error('Version conflict');
        for (const edit of request.arguments.edits as { old_str: string; new_str: string }[]) {
          if (body.split(edit.old_str).length !== 2) throw new Error('Non-unique edit');
          body = body.replace(edit.old_str, edit.new_str);
        }
        version++;
      }
      return { isError: false, structuredContent: { ...grant, version, body }, content: [{ type: 'text', text: body }] };
    },
    async close() {},
  } : await connect!();
  return { grant, close: () => client.close(), async invoke(request: { name: string; arguments: Record<string, unknown> }) {
    const operation = randomUUID(), path = join(directory, 'derive-' + operation + '.json');
    const receipt = { operation, ...grant, method: request.name,
      inputHash: createHash('sha256').update(JSON.stringify(request.arguments)).digest('hex'), at: new Date().toISOString() };
    writeFileSync(path, JSON.stringify({ ...receipt, outcome: 'dispatching' }), { flag: 'wx', mode: 0o600 });
    try {
      const result = await client.call(request);
      if (result.isError) throw new Error('Upstream result requires inspection');
      writeFileSync(path, JSON.stringify({ ...receipt, outcome: 'returned', result }));
      return result;
    } catch {
      writeFileSync(path, JSON.stringify({ ...receipt, outcome: 'uncertain' }));
      throw Object.assign(new Error('Inspect artifact and operation receipt before retry'), { saved: [], operation });
    }
  } };
}
