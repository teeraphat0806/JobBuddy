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
  /** Get the user, creating a bare row if missing (e.g. friends added before the bot existed). */
  ensure(lineUserId: string): Promise<User>;
  recordConsent(userId: string): Promise<void>;
  /**
   * Reminders are pushes (they use the monthly quota), so users can turn them off: interview
   * reminders and the daily follow-up digest go together.
   */
  setReminders(userId: string, on: boolean): Promise<void>;
  /** PDPA "delete my data": removes the user and, via cascade, everything they own. */
  deleteByLineUserId(lineUserId: string): Promise<void>;
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

    async ensure(lineUserId) {
      // DO UPDATE (not DO NOTHING) so RETURNING yields the row whether or not it existed.
      const [row] = await db
        .insert(users)
        .values({ lineUserId })
        .onConflictDoUpdate({ target: users.lineUserId, set: { lineUserId } })
        .returning();
      if (!row) throw new Error('ensure returned no row');
      return row;
    },

    async recordConsent(userId) {
      await db.update(users).set({ pdpaConsentedAt: new Date() }).where(eq(users.id, userId));
    },

    async setReminders(userId, on) {
      await db
        .update(users)
        .set({ notifyInterviewReminders: on, notifyFollowUps: on })
        .where(eq(users.id, userId));
    },

    async deleteByLineUserId(lineUserId) {
      await db.delete(users).where(eq(users.lineUserId, lineUserId));
    },
  };
}
