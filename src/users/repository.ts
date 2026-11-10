import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users, type User } from '../db/schema.js';

export interface LineProfile {
  displayName?: string | undefined;
  pictureUrl?: string | undefined;
  language?: string | undefined;
}

export interface UserRepository {
  upsertOnFollow(lineUserId: string, profile: LineProfile): Promise<User>;
  markUnfollowed(lineUserId: string): Promise<void>;
  findByLineUserId(lineUserId: string): Promise<User | undefined>;
}

export function createUserRepository(db: Db): UserRepository {
  return {
    async upsertOnFollow(lineUserId, profile) {
      const now = new Date();
      // Only overwrite profile fields we actually received, so a failed profile lookup
      // on re-follow doesn't wipe the name we already have.
      const profileFields: Partial<Pick<User, 'displayName' | 'pictureUrl' | 'language'>> = {};
      if (profile.displayName !== undefined) profileFields.displayName = profile.displayName;
      if (profile.pictureUrl !== undefined) profileFields.pictureUrl = profile.pictureUrl;
      if (profile.language !== undefined) profileFields.language = profile.language;

      const followFields = { status: 'active' as const, followedAt: now, unfollowedAt: null };
      const [row] = await db
        .insert(users)
        .values({ lineUserId, ...profileFields, ...followFields })
        .onConflictDoUpdate({
          target: users.lineUserId,
          set: { ...profileFields, ...followFields, updatedAt: now },
        })
        .returning();
      if (!row) throw new Error('upsertOnFollow returned no row');
      return row;
    },

    async markUnfollowed(lineUserId) {
      await db
        .update(users)
        .set({ status: 'unfollowed', unfollowedAt: new Date() })
        .where(eq(users.lineUserId, lineUserId));
    },

    async findByLineUserId(lineUserId) {
      return db.query.users.findFirst({ where: eq(users.lineUserId, lineUserId) });
    },
  };
}
