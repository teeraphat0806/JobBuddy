import { and, asc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { interviews, jobs, users, type Interview, type Job } from '../db/schema.js';

export type ReminderKind = 'evening' | 'soon';

export interface InterviewWithJob {
  interview: Interview;
  job: Job;
}

export interface ReminderCandidate extends InterviewWithJob {
  lineUserId: string;
}

export interface InterviewRepository {
  create(userId: string, jobId: string, startsAt: Date): Promise<Interview>;
  /** Only returns the interview if it belongs to `userId`. */
  get(userId: string, id: string): Promise<InterviewWithJob | undefined>;
  /** Moves the interview and re-arms its reminders. false if not found. */
  reschedule(userId: string, id: string, startsAt: Date): Promise<boolean>;
  setPlace(userId: string, id: string, place: string | null): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
  /** Interviews starting after `from`, soonest first. */
  upcoming(userId: string, from: Date, limit: number): Promise<InterviewWithJob[]>;
  upcomingForJob(userId: string, jobId: string, from: Date): Promise<Interview[]>;
  /** Interviews in (from, to] of users who want reminders and still have one unsent. */
  reminderCandidates(from: Date, to: Date): Promise<ReminderCandidate[]>;
  /** Atomically marks a reminder sent; false if another run already did. */
  claimReminder(id: string, kind: ReminderKind, at: Date): Promise<boolean>;
}

export function createInterviewRepository(db: Db): InterviewRepository {
  const mine = (userId: string, id: string) =>
    and(eq(interviews.id, id), eq(interviews.userId, userId));

  return {
    async create(userId, jobId, startsAt) {
      const [row] = await db
        .insert(interviews)
        .values({ userId, jobId, startsAt, scheduledAt: new Date() })
        .returning();
      if (!row) throw new Error('create interview returned no row');
      return row;
    },

    async get(userId, id) {
      const [row] = await db
        .select({ interview: interviews, job: jobs })
        .from(interviews)
        .innerJoin(jobs, eq(interviews.jobId, jobs.id))
        .where(mine(userId, id));
      return row;
    },

    async reschedule(userId, id, startsAt) {
      const rows = await db
        .update(interviews)
        .set({ startsAt, scheduledAt: new Date(), remindedEveningAt: null, remindedSoonAt: null })
        .where(mine(userId, id))
        .returning({ id: interviews.id });
      return rows.length > 0;
    },

    async setPlace(userId, id, place) {
      const rows = await db
        .update(interviews)
        .set({ place })
        .where(mine(userId, id))
        .returning({ id: interviews.id });
      return rows.length > 0;
    },

    async remove(userId, id) {
      const rows = await db
        .delete(interviews)
        .where(mine(userId, id))
        .returning({ id: interviews.id });
      return rows.length > 0;
    },

    upcoming: (userId, from, limit) =>
      db
        .select({ interview: interviews, job: jobs })
        .from(interviews)
        .innerJoin(jobs, eq(interviews.jobId, jobs.id))
        .where(and(eq(interviews.userId, userId), gt(interviews.startsAt, from)))
        .orderBy(asc(interviews.startsAt))
        .limit(limit),

    upcomingForJob: (userId, jobId, from) =>
      db
        .select()
        .from(interviews)
        .where(
          and(
            eq(interviews.userId, userId),
            eq(interviews.jobId, jobId),
            gt(interviews.startsAt, from),
          ),
        )
        .orderBy(asc(interviews.startsAt)),

    reminderCandidates: (from, to) =>
      db
        .select({ interview: interviews, job: jobs, lineUserId: users.lineUserId })
        .from(interviews)
        .innerJoin(jobs, eq(interviews.jobId, jobs.id))
        .innerJoin(users, eq(interviews.userId, users.id))
        .where(
          and(
            gt(interviews.startsAt, from),
            lte(interviews.startsAt, to),
            eq(users.status, 'active'),
            eq(users.notifyInterviewReminders, true),
            isNotNull(users.pdpaConsentedAt),
            or(isNull(interviews.remindedEveningAt), isNull(interviews.remindedSoonAt)),
          ),
        ),

    async claimReminder(id, kind, at) {
      const col = kind === 'evening' ? interviews.remindedEveningAt : interviews.remindedSoonAt;
      const rows = await db
        .update(interviews)
        .set(kind === 'evening' ? { remindedEveningAt: at } : { remindedSoonAt: at })
        .where(and(eq(interviews.id, id), isNull(col)))
        .returning({ id: interviews.id });
      return rows.length > 0;
    },
  };
}
