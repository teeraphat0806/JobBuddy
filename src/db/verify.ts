import { getTableName, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import {
  conversationSessions,
  interviews,
  jobNotes,
  jobPreferences,
  jobs,
  userJobs,
  users,
} from './schema.js';

/** Every table the app needs. Keep in sync with schema.ts. */
export const REQUIRED_TABLES = [
  users,
  jobPreferences,
  conversationSessions,
  jobs,
  userJobs,
  interviews,
  jobNotes,
].map((t) => getTableName(t));

/** Tables the app needs that don't exist in the `public` schema. */
export async function missingTables(db: Db): Promise<string[]> {
  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const present = new Set(rows.map((r) => r.table_name));
  return REQUIRED_TABLES.filter((t) => !present.has(t));
}

/** "host:port/db" from a connection URL, without credentials, for logs. */
export function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}
