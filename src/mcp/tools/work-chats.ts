import { z } from 'zod';
import { chatPreview, externalPath, modelPair, text } from '../schemas.js';

export const workChats = {
  work_chat_open: { schema: z.strictObject({ identity: text, requestId: z.number().int().positive(),
    sourceClone: externalPath, worktree: externalPath, nameLabel: text.optional(), model: modelPair.optional() }),
  description: 'Preview a chat in an existing registered project task worktree; does not start Pi or send a prompt.' },
  work_chat_resume: { schema: z.strictObject({ id: text, model: modelPair.optional() }),
  description: 'Preview exact native history resume or identify an existing live pane. No launch.' },
  work_chat_new_empty: { schema: z.strictObject({ id: text, nameLabel: text.optional(), model: modelPair.optional() }),
  description: 'Preview explicit replacement only after positive native empty closure proof. No launch.' },
  work_chat_execute: { schema: z.strictObject({ preview: chatPreview, focus: z.boolean().optional() }),
  description: 'Execute a fresh exact work-chat preview in one background Herdr tab; partial results are not success. Never sends a prompt.' },
  work_chat_list: { schema: z.strictObject({}), description: 'Observe managed chat metadata and current ownership; unknown is not dead.' },
  work_chat_show: { schema: z.strictObject({ id: text }), description: 'Inspect one managed chat and native/pane observation.' },
};
