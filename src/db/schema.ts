import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

export const jobWorkplace = pgEnum('job_workplace', ['onsite', 'hybrid', 'remote']);

/**
 * Job postings collected from public ATS job-board APIs. Shared by all users.
 * We store only a summary and link out to the original posting for details.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** ATS provider, e.g. "greenhouse", "lever", "smartrecruiters". */
    provider: text('provider').notNull(),
    /** Company identifier on that provider (board token / account id). */
    board: text('board').notNull(),
    externalId: text('external_id').notNull(),
    company: text('company').notNull(),
    title: text('title').notNull(),
    location: text('location').notNull(),
    department: text('department'),
    /** null = the source doesn't say. */
    workplace: jobWorkplace('workplace'),
    url: text('url').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** false once the posting disappears from its board. */
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('jobs_source_unique').on(t.provider, t.board, t.externalId),
    index('jobs_active_idx').on(t.active),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export const userJobStatus = pgEnum('user_job_status', ['saved', 'applied', 'hidden']);

/** A user's relationship with a job: saved for later, applied, or hidden from the feed. */
export const userJobs = pgTable(
  'user_jobs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: userJobStatus('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.jobId] })],
);
