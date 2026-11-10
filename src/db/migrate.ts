import { errorFields, logger } from '../lib/logger.js';
import { runMigrations } from './runMigrations.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.error('DATABASE_URL is not set');
  process.exit(1);
}

try {
  await runMigrations(databaseUrl, logger);
} catch (err) {
  logger.error('Migration failed', errorFields(err));
  process.exitCode = 1;
}
