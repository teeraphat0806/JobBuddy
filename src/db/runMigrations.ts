import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Logger } from '../lib/logger.js';
import { createDb } from './client.js';
import { describeDatabase, missingTables } from './verify.js';

/**
 * Apply pending migrations, then prove the tables really exist.
 *
 * Drizzle trusts its journal (drizzle.__drizzle_migrations). If tables were dropped but the
 * journal survived, migrate() "succeeds" without creating anything — so check afterwards and
 * throw, making the deploy fail loudly instead of the bot failing silently on every message.
 */
export async function runMigrations(databaseUrl: string, logger: Logger): Promise<void> {
  const { db, sql } = createDb(databaseUrl, { max: 1, quiet: true });
  const database = describeDatabase(databaseUrl);
  try {
    logger.info('Running migrations', { database });
    await migrate(db, { migrationsFolder: 'drizzle' });
    const missing = await missingTables(db);
    if (missing.length > 0) {
      throw new Error(
        `Migrations ran but required tables are missing in ${database}: ${missing.join(', ')}. ` +
          'The migration journal (schema "drizzle") says they were applied, but schema "public" ' +
          'lacks them. See README "Database has no tables" for the reset steps.',
      );
    }
    logger.info('Migrations applied', { database });
  } finally {
    await sql.end();
  }
}
