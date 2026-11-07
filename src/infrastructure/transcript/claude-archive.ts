import { blockText, filled, walkRecords } from './archive-read.js';
import type { ReadEntry, ReadResult } from './archive-read.js';

const origins = ['human', 'peer', 'task_notification'] as const;

function content(message: unknown): unknown {
  return typeof message === 'object' && message !== null ? (message as { content?: unknown }).content : undefined;
}

export function claudeArchive(path: string, offset: number): ReadResult {
  const entries: ReadEntry[] = [];
  let name: string | null = null, cwd: string | null = null;
  const next = walkRecords(path, offset, r => {
    if (r.type === 'custom-title' && typeof r.customTitle === 'string') name = filled(r.customTitle) ? r.customTitle : null;
    if (r.type === 'agent-name' && typeof r.agentName === 'string') name = filled(r.agentName) ? r.agentName : null;
    if (typeof r.cwd === 'string') cwd = r.cwd;
    if (typeof r.uuid !== 'string' || typeof r.timestamp !== 'string') return;
    const base = { entryId: r.uuid, parentEntryId: typeof r.parentUuid === 'string' ? r.parentUuid : null, at: r.timestamp };
    if (r.type === 'user') {
      const origin = origins.find(o => o === r.turnOrigin);
      if (origin === undefined) return;
      const text = blockText(content(r.message));
      if (filled(text)) entries.push({ ...base, role: 'user', origin, text });
    } else if (r.type === 'assistant') {
      if (typeof r.message !== 'object' || r.message === null || (r.message as { stop_reason?: unknown }).stop_reason !== 'end_turn') return;
      const text = blockText(content(r.message));
      if (filled(text)) entries.push({ ...base, role: 'assistant', origin: 'human', text });
    }
  });
  return { entries, offset: next, name, cwd, parentNativeId: null };
}
