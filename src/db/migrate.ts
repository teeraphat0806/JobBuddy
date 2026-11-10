import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { errorFields, logger } from '../lib/logger.js';
import { createDb } from './client.js';
import { describeDatabase, missingTables } from './verify.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, sql } = createDb(databaseUrl, { max: 1 });
const database = describeDatabase(databaseUrl);

try {
  await migrate(db, { migrationsFolder: 'drizzle' });

  // Drizzle trusts its journal (drizzle.__drizzle_migrations). If tables were dropped but the
  // journal survived, migrate() "succeeds" without creating anything — catch that here so the
  // deploy fails loudly instead of the bot failing silently on every message.
  const missing = await missingTables(db);
  if (missing.length > 0) {
    logger.error('Migrations ran but required tables are missing', {
      database,
      missing,
      likelyCause:
        'The migration journal (schema "drizzle") says migrations were applied, but the tables in ' +
        'schema "public" are gone. See README "Database has no tables" for the reset steps.',
    });
    process.exitCode = 1;
  } else {
    logger.info('Migrations applied', { database });
  }
} catch (err) {
  logger.error('Migration failed', { database, ...errorFields(err) });
  process.exitCode = 1;
} finally {
  await sql.end();
}
