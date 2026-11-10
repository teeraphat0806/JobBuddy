import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobPreferences } from '../db/schema.js';
import type { PrefsInput } from './types.js';

export interface PrefsRepository {
  get(userId: string): Promise<PrefsInput | undefined>;
  save(userId: string, prefs: PrefsInput): Promise<void>;
}

export function createPrefsRepository(db: Db): PrefsRepository {
  return {
    async get(userId) {
      const row = await db.query.jobPreferences.findFirst({
        where: eq(jobPreferences.userId, userId),
      });
      if (!row) return undefined;
      return {
        positions: row.positions,
        locations: row.locations,
        workMode: row.workMode,
        minSalary: row.minSalary,
        excludedKeywords: row.excludedKeywords,
      };
    },

    async save(userId, prefs) {
      await db
        .insert(jobPreferences)
        .values({ userId, ...prefs })
        .onConflictDoUpdate({
          target: jobPreferences.userId,
          set: { ...prefs, updatedAt: new Date() },
        });
    },
  };
}
