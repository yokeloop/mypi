import type { EventTransports } from './delivery.js';
import { piEventSocket } from '../infrastructure/socket/pi-event-socket.js';

export const eventTransports: EventTransports = { pi: piEventSocket };
