import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { errorFields, logger } from '../lib/logger.js';
import { createDb } from './client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, sql } = createDb(databaseUrl, { max: 1 });

try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  logger.info('Migrations applied');
} catch (err) {
  logger.error('Migration failed', errorFields(err));
  process.exitCode = 1;
} finally {
  await sql.end();
}
