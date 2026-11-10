import { createHmac } from 'node:crypto';
import type { Logger } from '../src/lib/logger.js';

export function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
