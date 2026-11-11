import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createSessionRepository } from './conversation/repository.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/runMigrations.js';
import { missingTables } from './db/verify.js';
import { createJobRepository, createUserJobRepository } from './jobs/repository.js';
import { JOB_SOURCES } from './jobs/sources.js';
import { startJobSyncScheduler } from './jobs/sync.js';
import { createEventsHandler } from './line/handlers.js';
import { createLineMessenger } from './line/messenger.js';
import { createInterviewRepository } from './interviews/repository.js';
import { startReminderScheduler } from './interviews/reminders.js';
import { createLinkPreviewer } from './links/preview.js';
import { createLinkImportRepository } from './links/importRepository.js';
import { createLinkImportWorker } from './links/importWorker.js';
import { refreshLinkTitles } from './links/refreshTitles.js';
import { createLinkSaver } from './links/saveLink.js';
import { createNominatimGeocoder } from './geo/geocoder.js';
import { createGeocodeRepository } from './geo/repository.js';
import { createGeoService, createJobDistances } from './geo/service.js';
import { USER_AGENT } from './jobs/providers.js';
import { createNoteRepository } from './notes/repository.js';
import { createPlaceRepository } from './places/repository.js';
import { createRichMenuApi, loadRichMenuImage, syncRichMenu } from './line/richmenu.js';
import { errorFields, logger } from './lib/logger.js';
import { createPrefsRepository } from './prefs/repository.js';
import { createUserRepository } from './users/repository.js';

const env = loadEnv();

// Also migrate here, not only in Railway's pre-deploy step: it's idempotent, and the bot can't
// work without its tables, so refuse to start (and fail the deploy) rather than run broken.
try {
  await runMigrations(env.DATABASE_URL, logger);
} catch (err) {
  logger.error('Migration failed; not starting', errorFields(err));
  process.exit(1);
}

const { db, sql } = createDb(env.DATABASE_URL);
const line = createLineMessenger(env.LINE_CHANNEL_ACCESS_TOKEN);
const jobs = createJobRepository(db);
const interviews = createInterviewRepository(db);
const previewLink = createLinkPreviewer();
const userJobs = createUserJobRepository(db);
const places = createPlaceRepository(db);

// Messages with many links are saved in the background, then summarised in one push.
const linkImportRepo = createLinkImportRepository(db);
const linkImportWorker = createLinkImportWorker({
  imports: linkImportRepo,
  saveLink: createLinkSaver({ jobs, userJobs, previewLink }),
  line,
  logger,
});

// Home-to-job distances. Only public job-location text goes to the geocoder, never user data.
const geo = env.GEOCODING
  ? createGeoService({
      geocodes: createGeocodeRepository(db),
      geocoder: createNominatimGeocoder({ baseUrl: env.GEOCODER_URL, userAgent: USER_AGENT }),
      logger,
    })
  : null;
const distances = geo ? createJobDistances({ places, geo }) : undefined;
/** After a user adds a place, look up where their saved / applied jobs are, in the background. */
function warmDistances(user: { id: string }) {
  if (!geo) return;
  void Promise.all([userJobs.list(user.id, 'saved', 50), userJobs.list(user.id, 'applied', 50)])
    .then(([a, b]) => geo.cached([...a, ...b].map((i) => i.job.location)))
    .catch((err: unknown) => logger.warn('Could not warm distances', errorFields(err)));
}

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
    userJobs,
    notes: createNoteRepository(db),
    interviews,
    previewLink,
    places,
    distances,
    warmDistances,
    linkImports: { repo: linkImportRepo, kick: () => linkImports.kick() },
    timeZone: env.APP_TIMEZONE,
    line,
    logger,
    getAddFriendUrl: () => addFriendUrl,
  }),
  checkDatabase: async () => {
    // Also proves the schema exists: a reachable but empty database is just as broken.
    const missing = await missingTables(db);
    if (missing.length > 0) throw new Error(`Missing tables: ${missing.join(', ')}`);
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

// Links saved before job-board pages could be read keep the whole page title; fix them once.
void refreshLinkTitles({ jobs, previewLink, logger }).catch((err: unknown) =>
  logger.warn('Link title refresh failed', errorFields(err)),
);

// Also resumes links left in the queue by a restart.
const linkImports = linkImportWorker.start(30_000);

const stopJobSync = env.JOB_SYNC
  ? startJobSyncScheduler(jobs, JOB_SOURCES, logger, env.JOB_SYNC_INTERVAL_HOURS * 60 * 60 * 1000)
  : () => {};

const stopReminders = env.REMINDERS
  ? startReminderScheduler(
      { interviews, line, logger, timeZone: env.APP_TIMEZONE },
      env.REMINDER_INTERVAL_MINUTES * 60 * 1000,
    )
  : () => {};

async function shutdown(signal: string): Promise<void> {
  logger.info('Shutting down', { signal });
  stopJobSync();
  linkImports.stop();
  stopReminders();
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
