import { boolean, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userStatus = pgEnum('user_status', ['active', 'unfollowed']);

/** One row per LINE user who has added the Official Account as a friend. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  lineUserId: text('line_user_id').notNull().unique(),
  displayName: text('display_name'),
  pictureUrl: text('picture_url'),
  language: text('language'),
  status: userStatus('status').notNull().default('active'),
  /** Interview reminders are the only Push messages sent by default (Push counts against quota). */
  notifyInterviewReminders: boolean('notify_interview_reminders').notNull().default(true),
  pdpaConsentedAt: timestamp('pdpa_consented_at', { withTimezone: true }),
  followedAt: timestamp('followed_at', { withTimezone: true }),
  unfollowedAt: timestamp('unfollowed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
