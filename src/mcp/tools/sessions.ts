import { z } from 'zod';
import { tool } from '../schemas.js';
import { PERMISSION_MODES } from '../../app/open-session.js';
export const sessionTools = {
  sessions: tool(z.strictObject({}), 'Call to see which agent sessions mypi knows: the tree global → project → task with each session\'s key, agent, native id and state (live: its process is running; closed: only the saved row, which can be continued). Read-only: never starts, stops, registers or messages a session.',
    () => [{ name: 'sessions' }]),
  open_session: tool(z.strictObject({ keys: z.array(z.string()).min(1), agent: z.enum(['claude', 'pi']).optional(),
    permissionMode: z.enum(PERMISSION_MODES).optional() }), 'Call only when the user explicitly asks to open sessions (/open): for each key — a project code (MP), CODE-N, org/project or org/project#N — focuses the live session\'s Herdr tab, or opens a new Herdr tab in the engine root with MYPI_SCOPE set and starts the agent there, resuming the saved session with its own agent or starting a new one with agent (default: defaultAgent in home/settings.json, else claude). A task key creates its worktree first. permissionMode (Claude only) defaults to the calling session\'s mode. Needs a running Herdr server; writes no session rows.',
    a => [{ name: 'open_session', keys: a.keys, ...(a.agent === undefined ? {} : { agent: a.agent }),
      ...(a.permissionMode === undefined ? {} : { permissionMode: a.permissionMode }) }]),
};
