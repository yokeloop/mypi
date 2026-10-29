import type { EventTransports } from './delivery.js';
import { piEventSocket } from '../infrastructure/socket/pi-event-socket.js';
import { claudeInboxSocket } from '../infrastructure/socket/claude-inbox-socket.js';

export const eventTransports: EventTransports = { pi: piEventSocket, claude: claudeInboxSocket };
