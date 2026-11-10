import { validateSignature, type webhook } from '@line/bot-sdk';
import { Hono } from 'hono';
import type { EventsHandler } from './line/handlers.js';
import { errorFields, type Logger } from './lib/logger.js';

export interface AppDeps {
  channelSecret: string;
  handleEvents: EventsHandler;
  checkDatabase: () => Promise<void>;
  logger: Logger;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get('/health', async (c) => {
    try {
      await deps.checkDatabase();
      return c.json({ status: 'ok' });
    } catch (err) {
      deps.logger.error('Health check failed', errorFields(err));
      return c.json({ status: 'error', database: 'unreachable' }, 503);
    }
  });

  app.post('/webhooks/line', async (c) => {
    const signature = c.req.header('x-line-signature');
    const body = await c.req.text();

    if (!signature || !validateSignature(body, deps.channelSecret, signature)) {
      return c.json({ error: 'invalid signature' }, 401);
    }

    let payload: webhook.CallbackRequest;
    try {
      payload = JSON.parse(body) as webhook.CallbackRequest;
    } catch {
      return c.json({ error: 'invalid body' }, 400);
    }

    // Acknowledge LINE immediately; reply tokens stay valid long enough for async handling.
    // Slow work (AI parsing, email processing) will move to the worker queue later.
    deps.handleEvents(payload.events ?? []).catch((err: unknown) => {
      deps.logger.error('Unhandled error in event handler', errorFields(err));
    });

    return c.json({ ok: true });
  });

  return app;
}
