import { and, desc, eq, lt, max, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobs, userJobs, type Job } from '../db/schema.js';
import type { JobListing } from './types.js';

export type UserJobStatus = 'saved' | 'applied' | 'hidden';

export interface JobRepository {
  upsertListings(listings: JobListing[], seenAt: Date): Promise<void>;
  /** Deactivate a board's jobs that weren't seen in the run that started at `seenAt`. */
  deactivateMissing(provider: string, board: string, seenAt: Date): Promise<number>;
  listActive(): Promise<Job[]>;
  getById(id: string): Promise<Job | undefined>;
  lastSyncedAt(): Promise<Date | null>;
}

export interface UserJobRepository {
  /** Map of jobId -> status for everything this user has acted on. */
  statuses(userId: string): Promise<Map<string, UserJobStatus>>;
  getStatus(userId: string, jobId: string): Promise<UserJobStatus | undefined>;
  setStatus(userId: string, jobId: string, status: UserJobStatus): Promise<void>;
  clear(userId: string, jobId: string): Promise<void>;
  /** Most recently updated first. */
  list(userId: string, status: UserJobStatus, limit: number): Promise<Job[]>;
  count(userId: string, status: UserJobStatus): Promise<number>;
}

const CHUNK = 200;

export function createJobRepository(db: Db): JobRepository {
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

    listActive: () => db.select().from(jobs).where(eq(jobs.active, true)),

    getById: (id) => db.query.jobs.findFirst({ where: eq(jobs.id, id) }),

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

    async getStatus(userId, jobId) {
      const row = await db.query.userJobs.findFirst({
        where: and(eq(userJobs.userId, userId), eq(userJobs.jobId, jobId)),
      });
      return row?.status;
    },

    async setStatus(userId, jobId, status) {
      await db
        .insert(userJobs)
        .values({ userId, jobId, status })
        .onConflictDoUpdate({
          target: [userJobs.userId, userJobs.jobId],
          set: { status, updatedAt: new Date() },
        });
    },

    async clear(userId, jobId) {
      await db.delete(userJobs).where(and(eq(userJobs.userId, userId), eq(userJobs.jobId, jobId)));
    },

    async list(userId, status, limit) {
      const rows = await db
        .select({ job: jobs })
        .from(userJobs)
        .innerJoin(jobs, eq(userJobs.jobId, jobs.id))
        .where(and(eq(userJobs.userId, userId), eq(userJobs.status, status)))
        .orderBy(desc(userJobs.updatedAt))
        .limit(limit);
      return rows.map((r) => r.job);
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
