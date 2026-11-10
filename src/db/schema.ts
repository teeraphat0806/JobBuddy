import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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

export const workMode = pgEnum('work_mode', ['any', 'onsite', 'hybrid', 'remote']);

/** What kind of job a user is looking for. One set per user for now. */
export const jobPreferences = pgTable('job_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Job titles / roles, e.g. ["Data Analyst", "Backend Developer"]. */
  positions: text('positions').array().notNull(),
  /** Free-text locations; empty array means anywhere in Thailand. */
  locations: text('locations')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  workMode: workMode('work_mode').notNull().default('any'),
  /** Monthly salary floor in THB; null = not specified. */
  minSalary: integer('min_salary'),
  excludedKeywords: text('excluded_keywords')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type JobPreferences = typeof jobPreferences.$inferSelect;

/**
 * In-progress multi-step chat flow (e.g. the preferences wizard), one per user.
 * `state` is owned by the flow's own code; rows past `expiresAt` are treated as absent.
 */
export const conversationSessions = pgTable('conversation_sessions', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  flow: text('flow').notNull(),
  state: jsonb('state').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
