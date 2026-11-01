import { setTimeout as sleep } from 'node:timers/promises';
import type { EventTransports } from './delivery.js';
import { piEventSocket } from '../infrastructure/socket/pi-event-socket.js';
import { claudeInboxSocket } from '../infrastructure/socket/claude-inbox-socket.js';

export const eventTransports: EventTransports = { pi: piEventSocket, claude: claudeInboxSocket,
  pause: ms => sleep(ms) };
