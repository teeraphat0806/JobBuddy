import { and, desc, eq, lt, max, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobNotes, jobs, userJobs, type Job } from '../db/schema.js';
import type { JobListing } from './types.js';

export type UserJobStatus = 'saved' | 'applied' | 'hidden';
export type ApplicationStage =
  'applied' | 'contacted' | 'interview' | 'waiting' | 'offer' | 'rejected';

/** Jobs a user added by sending a link; kept out of everyone's feed. */
export const LINK_PROVIDER = 'link';

export interface LinkJobInput {
  board: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  department: string | null;
  workplace: Job['workplace'];
  url: string;
}

export interface UserJobEntry {
  status: UserJobStatus;
  stage: ApplicationStage | null;
}

export interface ListedJob {
  job: Job;
  stage: ApplicationStage | null;
  noteCount: number;
}

export interface JobRepository {
  upsertListings(listings: JobListing[], seenAt: Date): Promise<void>;
  /** Deactivate a board's jobs that weren't seen in the run that started at `seenAt`. */
  deactivateMissing(provider: string, board: string, seenAt: Date): Promise<number>;
  /** Active jobs from synced job boards (excludes jobs users added by link). */
  listActive(): Promise<Job[]>;
  getById(id: string): Promise<Job | undefined>;
  findByUrl(url: string): Promise<Job | undefined>;
  findBySource(provider: string, board: string, externalId: string): Promise<Job | undefined>;
  /** Insert a user-submitted job, or return the existing one for the same link. */
  createLinkJob(input: LinkJobInput): Promise<Job>;
  rename(id: string, title: string, company?: string): Promise<void>;
  /** Every job users added by link (for occasional maintenance). */
  listLinkJobs(): Promise<Job[]>;
  lastSyncedAt(): Promise<Date | null>;
}

export interface UserJobRepository {
  /** Map of jobId -> status for everything this user has acted on. */
  statuses(userId: string): Promise<Map<string, UserJobStatus>>;
  get(userId: string, jobId: string): Promise<UserJobEntry | undefined>;
  /** Setting 'applied' starts the stage at 'applied' unless it is already further along. */
  setStatus(userId: string, jobId: string, status: UserJobStatus): Promise<void>;
  /** Moves an application to `stage`, marking the job applied if it wasn't. */
  setStage(userId: string, jobId: string, stage: ApplicationStage): Promise<void>;
  clear(userId: string, jobId: string): Promise<void>;
  /** Most recently updated first. */
  list(userId: string, status: UserJobStatus, limit: number, offset?: number): Promise<ListedJob[]>;
  count(userId: string, status: UserJobStatus): Promise<number>;
  /** How many other users have this job in any list. */
  otherTrackers(userId: string, jobId: string): Promise<number>;
}

const CHUNK = 200;

export function createJobRepository(db: Db): JobRepository {
  const findBySource: JobRepository['findBySource'] = (provider, board, externalId) =>
    db.query.jobs.findFirst({
      where: and(
        eq(jobs.provider, provider),
        eq(jobs.board, board),
        eq(jobs.externalId, externalId),
      ),
    });

  return {
    async upsertListings(listings, seenAt) {
      for (let i = 0; i < listings.length; i += CHUNK) {
        const rows = listings.slice(i, i + CHUNK).map((l) => ({
          ...l,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          active: true,
        }));
        await db
          .insert(jobs)
          .values(rows)
          .onConflictDoUpdate({
            target: [jobs.provider, jobs.board, jobs.externalId],
            // firstSeenAt is deliberately not updated: it tells us when a job was new to us.
            set: {
              company: sql`excluded.company`,
              title: sql`excluded.title`,
              location: sql`excluded.location`,
              department: sql`excluded.department`,
              workplace: sql`excluded.workplace`,
              url: sql`excluded.url`,
              postedAt: sql`excluded.posted_at`,
              lastSeenAt: sql`excluded.last_seen_at`,
              active: true,
            },
          });
      }
    },

    async deactivateMissing(provider, board, seenAt) {
      const rows = await db
        .update(jobs)
        .set({ active: false })
        .where(
          and(
            eq(jobs.provider, provider),
            eq(jobs.board, board),
            eq(jobs.active, true),
            lt(jobs.lastSeenAt, seenAt),
          ),
        )
        .returning({ id: jobs.id });
      return rows.length;
    },

    listActive: () =>
      db
        .select()
        .from(jobs)
        .where(and(eq(jobs.active, true), ne(jobs.provider, LINK_PROVIDER))),

    getById: (id) => db.query.jobs.findFirst({ where: eq(jobs.id, id) }),

    findByUrl: (url) => db.query.jobs.findFirst({ where: eq(jobs.url, url) }),

    findBySource,

    async createLinkJob(input) {
      const [row] = await db
        .insert(jobs)
        .values({ ...input, provider: LINK_PROVIDER, postedAt: null })
        .onConflictDoNothing({ target: [jobs.provider, jobs.board, jobs.externalId] })
        .returning();
      if (row) return row;
      const existing = await findBySource(LINK_PROVIDER, input.board, input.externalId);
      if (!existing) throw new Error('Link job vanished after insert conflict');
      return existing;
    },

    async rename(id, title, company) {
      await db
        .update(jobs)
        .set(company ? { title, company } : { title })
        .where(eq(jobs.id, id));
    },

    listLinkJobs: () => db.select().from(jobs).where(eq(jobs.provider, LINK_PROVIDER)),

    async lastSyncedAt() {
      const [row] = await db.select({ at: max(jobs.lastSeenAt) }).from(jobs);
      return row?.at ?? null;
    },
  };
}

export function createUserJobRepository(db: Db): UserJobRepository {
  return {
    async statuses(userId) {
      const rows = await db
        .select({ jobId: userJobs.jobId, status: userJobs.status })
        .from(userJobs)
        .where(eq(userJobs.userId, userId));
      return new Map(rows.map((r) => [r.jobId, r.status]));
    },

    async get(userId, jobId) {
      const row = await db.query.userJobs.findFirst({
        where: and(eq(userJobs.userId, userId), eq(userJobs.jobId, jobId)),
      });
      return row ? { status: row.status, stage: row.stage } : undefined;
    },

    async setStatus(userId, jobId, status) {
      const applied = status === 'applied';
      await db
        .insert(userJobs)
        .values({ userId, jobId, status, stage: applied ? 'applied' : null })
        .onConflictDoUpdate({
          target: [userJobs.userId, userJobs.jobId],
          set: {
            status,
            stage: applied ? sql`coalesce(${userJobs.stage}, 'applied')` : null,
            updatedAt: new Date(),
          },
        });
    },

    async setStage(userId, jobId, stage) {
      await db
        .insert(userJobs)
        .values({ userId, jobId, status: 'applied', stage })
        .onConflictDoUpdate({
          target: [userJobs.userId, userJobs.jobId],
          set: { status: 'applied', stage, updatedAt: new Date() },
        });
    },

    async clear(userId, jobId) {
      await db.delete(userJobs).where(and(eq(userJobs.userId, userId), eq(userJobs.jobId, jobId)));
    },

    list(userId, status, limit, offset = 0) {
      const noteCount = sql<number>`(
        select count(*)::int from ${jobNotes}
        where ${jobNotes.userId} = ${userJobs.userId} and ${jobNotes.jobId} = ${userJobs.jobId}
      )`;
      return db
        .select({ job: jobs, stage: userJobs.stage, noteCount })
        .from(userJobs)
        .innerJoin(jobs, eq(userJobs.jobId, jobs.id))
        .where(and(eq(userJobs.userId, userId), eq(userJobs.status, status)))
        .orderBy(desc(userJobs.updatedAt), desc(userJobs.jobId))
        .limit(limit)
        .offset(offset);
    },

    async otherTrackers(userId, jobId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(userJobs)
        .where(and(eq(userJobs.jobId, jobId), ne(userJobs.userId, userId)));
      return row?.n ?? 0;
    },

    async count(userId, status) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(userJobs)
        .where(and(eq(userJobs.userId, userId), eq(userJobs.status, status)));
      return row?.n ?? 0;
    },
  };
}
