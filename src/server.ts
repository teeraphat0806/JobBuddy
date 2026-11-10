import { serve } from '@hono/node-server';
import { sql as rawSql } from 'drizzle-orm';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createSessionRepository } from './conversation/repository.js';
import { createDb } from './db/client.js';
import { createJobRepository, createUserJobRepository } from './jobs/repository.js';
import { JOB_SOURCES } from './jobs/sources.js';
import { startJobSyncScheduler } from './jobs/sync.js';
import { createEventsHandler } from './line/handlers.js';
import { createLineMessenger } from './line/messenger.js';
import { createRichMenuApi, loadRichMenuImage, syncRichMenu } from './line/richmenu.js';
import { errorFields, logger } from './lib/logger.js';
import { createPrefsRepository } from './prefs/repository.js';
import { createUserRepository } from './users/repository.js';

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);
const line = createLineMessenger(env.LINE_CHANNEL_ACCESS_TOKEN);
const jobs = createJobRepository(db);

// Filled in once at startup; shared job cards include it so friends can add the bot.
let addFriendUrl: string | undefined;
line
  .getBotBasicId()
  .then((id) => {
    addFriendUrl = `https://line.me/R/ti/p/${encodeURIComponent(id)}`;
  })
  .catch((err: unknown) => logger.warn('Could not read bot basic ID', errorFields(err)));

const app = createApp({
  channelSecret: env.LINE_CHANNEL_SECRET,
  handleEvents: createEventsHandler({
    users: createUserRepository(db),
    prefs: createPrefsRepository(db),
    sessions: createSessionRepository(db),
    jobs,
    userJobs: createUserJobRepository(db),
    line,
    logger,
    getAddFriendUrl: () => addFriendUrl,
  }),
  checkDatabase: async () => {
    await db.execute(rawSql`select 1`);
  },
  logger,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info('JobBuddy API listening', { port: info.port, env: env.NODE_ENV });
});

// Keep the LINE rich menu in sync with the code. Failure must not stop the webhook.
if (env.RICH_MENU_SYNC) {
  syncRichMenu(createRichMenuApi(env.LINE_CHANNEL_ACCESS_TOKEN), () => loadRichMenuImage(), logger)
    .then(() => logger.info('Rich menu in sync'))
    .catch((err: unknown) => logger.warn('Rich menu sync failed', errorFields(err)));
}

const stopJobSync = env.JOB_SYNC
  ? startJobSyncScheduler(jobs, JOB_SOURCES, logger, env.JOB_SYNC_INTERVAL_HOURS * 60 * 60 * 1000)
  : () => {};

async function shutdown(signal: string): Promise<void> {
  logger.info('Shutting down', { signal });
  stopJobSync();
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
