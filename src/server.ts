import { serve } from '@hono/node-server';
import { sql as rawSql } from 'drizzle-orm';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { createEventsHandler } from './line/handlers.js';
import { createLineMessenger } from './line/messenger.js';
import { errorFields, logger } from './lib/logger.js';
import { createUserRepository } from './users/repository.js';

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);

const app = createApp({
  channelSecret: env.LINE_CHANNEL_SECRET,
  handleEvents: createEventsHandler({
    users: createUserRepository(db),
    line: createLineMessenger(env.LINE_CHANNEL_ACCESS_TOKEN),
    logger,
  }),
  checkDatabase: async () => {
    await db.execute(rawSql`select 1`);
  },
  logger,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info('JobBuddy API listening', { port: info.port, env: env.NODE_ENV });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('Shutting down', { signal });
  server.close();
  try {
    await sql.end({ timeout: 5 });
  } catch (err) {
    logger.error('Error closing database', errorFields(err));
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
