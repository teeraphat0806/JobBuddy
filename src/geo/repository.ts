import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { geocodes, type Geocode } from '../db/schema.js';
import type { GeocodeResult } from './geocoder.js';

export interface GeocodeRepository {
  getMany(queries: string[]): Promise<Map<string, Geocode>>;
  /** Stores a lookup; `null` remembers "not found / too coarse". */
  put(query: string, result: GeocodeResult | null): Promise<void>;
}

export function createGeocodeRepository(db: Db): GeocodeRepository {
  return {
    async getMany(queries) {
      if (queries.length === 0) return new Map();
      const rows = await db.select().from(geocodes).where(inArray(geocodes.query, queries));
      return new Map(rows.map((r) => [r.query, r]));
    },
    async put(query, result) {
      const values = {
        query,
        lat: result?.lat ?? null,
        lng: result?.lng ?? null,
        label: result?.label ?? null,
        placeRank: result?.rank ?? null,
        resolvedAt: new Date(),
      };
      await db
        .insert(geocodes)
        .values(values)
        .onConflictDoUpdate({ target: geocodes.query, set: values });
    },
  };
}
