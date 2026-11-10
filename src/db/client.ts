import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(databaseUrl: string, options: { max?: number; quiet?: boolean } = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    // Migrations emit harmless NOTICEs ("schema already exists, skipping").
    ...(options.quiet ? { onnotice: () => {} } : {}),
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
