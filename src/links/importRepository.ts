import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobs, linkImportBatches, linkImports, users } from '../db/schema.js';

export type ImportOutcome = 'new' | 'duplicate' | 'invalid' | 'failed';

export interface ClaimedImport {
  id: string;
  batchId: string;
  userId: string;
  url: string;
}

/** Everything a user sent since their last summary, once all of it has been processed. */
export interface ImportSummary {
  userId: string;
  lineUserId: string;
  /** Links received, repeats included. */
  total: number;
  /** Repeats inside the same message (never queued). */
  repeated: number;
  counts: Record<ImportOutcome, number>;
  /** The first few newly saved jobs, for the summary text. */
  newJobs: { title: string; company: string }[];
}

export interface LinkImportRepository {
  /** Queues one message's links (already de-duplicated). Returns the batch id. */
  enqueue(userId: string, urls: string[], total: number, repeated: number): Promise<string>;
  /** Links still waiting or in progress for this user. */
  queuedCount(userId: string): Promise<number>;
  /**
   * Takes up to `limit` links to work on, oldest first but taking turns between users so one
   * big import doesn't hold up everyone else. Links claimed by a worker that died are retaken.
   */
  claim(limit: number): Promise<ClaimedImport[]>;
  finish(id: string, outcome: ImportOutcome, jobId: string | null): Promise<void>;
  /**
   * For each user whose queue is now empty: claims their finished batches (so only one worker
   * reports them), returns one combined summary and deletes the batches.
   */
  takeFinished(newJobsShown: number): Promise<ImportSummary[]>;
}

const STALE = sql`now() - interval '10 minutes'`;

export function createLinkImportRepository(db: Db): LinkImportRepository {
  return {
    async enqueue(userId, urls, total, repeated) {
      return db.transaction(async (tx) => {
        const [batch] = await tx
          .insert(linkImportBatches)
          .values({ userId, total, repeated })
          .returning({ id: linkImportBatches.id });
        const batchId = batch!.id;
        // A millisecond apart, so links are saved (and listed) in the order they were sent.
        const base = Date.now();
        for (let i = 0; i < urls.length; i += 500) {
          await tx.insert(linkImports).values(
            urls.slice(i, i + 500).map((url, j) => ({
              batchId,
              userId,
              url,
              createdAt: new Date(base + i + j),
            })),
          );
        }
        return batchId;
      });
    },

    async queuedCount(userId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(linkImports)
        .where(and(eq(linkImports.userId, userId), sql`${linkImports.status} <> 'done'`));
      return row?.n ?? 0;
    },

    async claim(limit) {
      const available = sql`(${linkImports.status} = 'pending' or
        (${linkImports.status} = 'working' and ${linkImports.claimedAt} < ${STALE}))`;
      // Each user's 1st link, then each user's 2nd, ... (oldest first within a turn).
      const candidates = await db.execute<{ id: string }>(sql`
        select id from (
          select ${linkImports.id} as id, ${linkImports.createdAt} as created_at,
            row_number() over (
              partition by ${linkImports.userId}
              order by ${linkImports.createdAt}, ${linkImports.id}
            ) as turn
          from ${linkImports}
          where ${available}
        ) c
        order by turn, created_at
        limit ${limit}`);
      if (candidates.length === 0) return [];
      // Re-checked under the row lock, so two workers can't both take the same link.
      return db
        .update(linkImports)
        .set({ status: 'working', claimedAt: sql`now()` })
        .where(
          and(
            inArray(
              linkImports.id,
              candidates.map((c) => c.id),
            ),
            available,
          ),
        )
        .returning({
          id: linkImports.id,
          batchId: linkImports.batchId,
          userId: linkImports.userId,
          url: linkImports.url,
        });
    },

    async finish(id, outcome, jobId) {
      await db
        .update(linkImports)
        .set({ status: 'done', outcome, jobId, doneAt: sql`now()` })
        .where(eq(linkImports.id, id));
    },

    async takeFinished(newJobsShown) {
      const claimed = await db
        .update(linkImportBatches)
        .set({ notifiedAt: sql`now()` })
        .where(
          and(
            sql`${linkImportBatches.notifiedAt} is null`,
            sql`not exists (select 1 from ${linkImports} i
              where i.user_id = ${linkImportBatches.userId} and i.status <> 'done')`,
          ),
        )
        .returning({
          id: linkImportBatches.id,
          userId: linkImportBatches.userId,
          total: linkImportBatches.total,
          repeated: linkImportBatches.repeated,
        });
      if (claimed.length === 0) return [];

      const byUser = new Map<string, typeof claimed>();
      for (const b of claimed) byUser.set(b.userId, [...(byUser.get(b.userId) ?? []), b]);

      const out: ImportSummary[] = [];
      for (const [userId, batches] of byUser) {
        const ids = batches.map((b) => b.id);
        const [user, outcomes, newJobs] = await Promise.all([
          db.query.users.findFirst({ where: eq(users.id, userId) }),
          db
            .select({ outcome: linkImports.outcome, n: sql<number>`count(*)::int` })
            .from(linkImports)
            .where(inArray(linkImports.batchId, ids))
            .groupBy(linkImports.outcome),
          db
            .select({ title: jobs.title, company: jobs.company })
            .from(linkImports)
            .innerJoin(jobs, eq(linkImports.jobId, jobs.id))
            .where(and(inArray(linkImports.batchId, ids), eq(linkImports.outcome, 'new')))
            .orderBy(linkImports.createdAt)
            .limit(newJobsShown),
        ]);
        const counts: Record<ImportOutcome, number> = {
          new: 0,
          duplicate: 0,
          invalid: 0,
          failed: 0,
        };
        for (const o of outcomes) if (o.outcome) counts[o.outcome] = o.n;
        if (user) {
          out.push({
            userId,
            lineUserId: user.lineUserId,
            total: batches.reduce((n, b) => n + b.total, 0),
            repeated: batches.reduce((n, b) => n + b.repeated, 0),
            counts,
            newJobs,
          });
        }
        // Reported: the rows have done their job (the saved jobs live in user_jobs).
        await db.delete(linkImportBatches).where(inArray(linkImportBatches.id, ids));
      }
      return out;
    },
  };
}
