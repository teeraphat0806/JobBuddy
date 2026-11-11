import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { ApplicationStage } from '../jobs/repository.js';

/** Days in one stage (applied / contacted / waiting) before we suggest following up. */
export const FOLLOW_UP_DAYS = 7;
/** "Remind me later" pushes the next nudge this far out. */
export const SNOOZE_DAYS = 7;
/** Stages where the ball is in the company's court. */
export const FOLLOW_UP_STAGES: readonly ApplicationStage[] = ['applied', 'contacted', 'waiting'];

export interface DigestUser {
  userId: string;
  lineUserId: string;
}

export interface FollowUpItem {
  jobId: string;
  title: string;
  company: string;
  stage: ApplicationStage;
  stageSince: Date;
}

export interface ClosedItem {
  jobId: string;
  title: string;
  company: string;
}

export interface DigestRepository {
  /** Users with something to report who haven't had a digest yet on this local day. */
  dueUsers(now: Date, timeZone: string, limit: number): Promise<DigestUser[]>;
  /** Marks today's digest as taken for this user; false if it already was (another run). */
  claimUser(userId: string, now: Date, timeZone: string): Promise<boolean>;
  /** Applications that have waited long enough, marked as nudged. */
  claimFollowUps(userId: string, now: Date, timeZone: string): Promise<FollowUpItem[]>;
  /** Saved jobs whose posting closed, marked as reported. */
  claimClosed(userId: string, now: Date): Promise<ClosedItem[]>;
  /** No nudge for this application before `until`. Returns false if it isn't theirs. */
  snooze(userId: string, jobId: string, until: Date): Promise<boolean>;
}

const iso = (d: Date) => d.toISOString();

/** The user's local calendar day of `now`. */
const today = (now: Date, tz: string) => sql`(${iso(now)}::timestamptz at time zone ${tz})::date`;

/**
 * A nudge is due once the stage is FOLLOW_UP_DAYS old (or the snooze ends, if later), and only
 * once per stage: changing the stage or snoozing sets a new due day. Compared by local day so
 * everything due "today" goes out together.
 */
function followUpDue(now: Date, tz: string): SQL {
  const stages = sql.join(
    FOLLOW_UP_STAGES.map((s) => sql`${s}`),
    sql`, `,
  );
  const dueDay = sql`greatest(
    (uj.stage_changed_at at time zone ${tz})::date + ${FOLLOW_UP_DAYS}::int,
    coalesce((uj.follow_up_snoozed_until at time zone ${tz})::date, '-infinity'::date)
  )`;
  return sql`uj.status = 'applied' and uj.stage::text in (${stages})
    and uj.stage_changed_at is not null
    and ${dueDay} <= ${today(now, tz)}
    and (uj.follow_up_sent_at is null or (uj.follow_up_sent_at at time zone ${tz})::date < ${dueDay})`;
}

/** Saved (not yet applied) synced jobs that have left their board. */
const closedDue = sql`uj.status = 'saved' and uj.closed_notified_at is null
  and j.active = false and j.provider <> 'link'`;

const asDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

export function createDigestRepository(db: Db): DigestRepository {
  return {
    async dueUsers(now, tz, limit) {
      const rows = await db.execute<{ id: string; line_user_id: string }>(sql`
        select u.id, u.line_user_id from users u
        where u.status = 'active' and u.notify_follow_ups and u.pdpa_consented_at is not null
          and (u.last_digest_at is null
            or (u.last_digest_at at time zone ${tz})::date < ${today(now, tz)})
          and (
            exists (select 1 from user_jobs uj where uj.user_id = u.id and ${followUpDue(now, tz)})
            or exists (select 1 from user_jobs uj join jobs j on j.id = uj.job_id
              where uj.user_id = u.id and ${closedDue})
          )
        order by u.id
        limit ${limit}`);
      return rows.map((r) => ({ userId: r.id, lineUserId: r.line_user_id }));
    },

    async claimUser(userId, now, tz) {
      const rows = await db.execute(sql`
        update users set last_digest_at = ${iso(now)}::timestamptz
        where id = ${userId} and (last_digest_at is null
          or (last_digest_at at time zone ${tz})::date < ${today(now, tz)})
        returning id`);
      return rows.length > 0;
    },

    async claimFollowUps(userId, now, tz) {
      const rows = await db.execute<{
        job_id: string;
        title: string;
        company: string;
        stage: ApplicationStage;
        stage_changed_at: Date | string;
      }>(sql`
        update user_jobs uj set follow_up_sent_at = ${iso(now)}::timestamptz
        from jobs j
        where j.id = uj.job_id and uj.user_id = ${userId} and ${followUpDue(now, tz)}
        returning uj.job_id, j.title, j.company, uj.stage, uj.stage_changed_at`);
      return rows
        .map((r) => ({
          jobId: r.job_id,
          title: r.title,
          company: r.company,
          stage: r.stage,
          stageSince: asDate(r.stage_changed_at),
        }))
        .sort((a, b) => a.stageSince.getTime() - b.stageSince.getTime());
    },

    async claimClosed(userId, now) {
      const rows = await db.execute<{ job_id: string; title: string; company: string }>(sql`
        update user_jobs uj set closed_notified_at = ${iso(now)}::timestamptz
        from jobs j
        where j.id = uj.job_id and uj.user_id = ${userId} and ${closedDue}
        returning uj.job_id, j.title, j.company`);
      return rows.map((r) => ({ jobId: r.job_id, title: r.title, company: r.company }));
    },

    async snooze(userId, jobId, until) {
      const rows = await db.execute(sql`
        update user_jobs set follow_up_snoozed_until = ${iso(until)}::timestamptz
        where user_id = ${userId} and job_id = ${jobId} and status = 'applied'
        returning job_id`);
      return rows.length > 0;
    },
  };
}
