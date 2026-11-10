import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobNotes, type JobNote } from '../db/schema.js';

export interface NoteRepository {
  add(userId: string, jobId: string, body: string): Promise<void>;
  /** Newest first. */
  list(userId: string, jobId: string, limit: number): Promise<JobNote[]>;
  count(userId: string, jobId: string): Promise<number>;
}

export function createNoteRepository(db: Db): NoteRepository {
  const forJob = (userId: string, jobId: string) =>
    and(eq(jobNotes.userId, userId), eq(jobNotes.jobId, jobId));
  return {
    async add(userId, jobId, body) {
      await db.insert(jobNotes).values({ userId, jobId, body });
    },
    list: (userId, jobId, limit) =>
      db
        .select()
        .from(jobNotes)
        .where(forJob(userId, jobId))
        .orderBy(desc(jobNotes.createdAt))
        .limit(limit),
    async count(userId, jobId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(jobNotes)
        .where(forJob(userId, jobId));
      return row?.n ?? 0;
    },
  };
}
