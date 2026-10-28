import { z } from 'zod';
import { tool } from '../schemas.js';
export const sessionTools = {
  sessions: tool(z.strictObject({}), 'Call to see which agent sessions mypi knows: the tree global → project → task with each session\'s key, agent, native id and state (live: its process is running; closed: only the saved row, which can be continued). Read-only: never starts, stops, registers or messages a session.',
    () => [{ name: 'sessions' }]),
};
