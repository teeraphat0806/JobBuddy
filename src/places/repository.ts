import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { userPlaces, type UserPlace } from '../db/schema.js';

export interface PlaceRepository {
  /** Oldest first, so "บ้าน" (usually the first one) stays on top. */
  list(userId: string): Promise<UserPlace[]>;
  add(userId: string, label: string, lat: number, lng: number): Promise<UserPlace>;
  /** Returns false if the place isn't the user's. */
  rename(userId: string, id: string, label: string): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
}

export function createPlaceRepository(db: Db): PlaceRepository {
  const own = (userId: string, id: string) =>
    and(eq(userPlaces.userId, userId), eq(userPlaces.id, id));
  return {
    list: (userId) =>
      db
        .select()
        .from(userPlaces)
        .where(eq(userPlaces.userId, userId))
        .orderBy(asc(userPlaces.createdAt), asc(userPlaces.id)),
    async add(userId, label, lat, lng) {
      const [row] = await db.insert(userPlaces).values({ userId, label, lat, lng }).returning();
      return row!;
    },
    async rename(userId, id, label) {
      const rows = await db
        .update(userPlaces)
        .set({ label })
        .where(own(userId, id))
        .returning({ id: userPlaces.id });
      return rows.length > 0;
    },
    async remove(userId, id) {
      const rows = await db
        .delete(userPlaces)
        .where(own(userId, id))
        .returning({ id: userPlaces.id });
      return rows.length > 0;
    },
  };
}
