import { localParts } from '../interviews/time.js';
import { errorFields, type Logger } from '../lib/logger.js';
import { digestMessages } from '../line/followups.js';
import type { LineMessenger } from '../line/messenger.js';
import type { DigestRepository } from './repository.js';

/** Digests go out between these local hours: not at night, and after people are up. */
export const DIGEST_FROM_HOUR = 10;
export const DIGEST_UNTIL_HOUR = 20;
const USERS_PER_RUN = 200;

export interface DigestDeps {
  digests: DigestRepository;
  line: Pick<LineMessenger, 'push'>;
  logger: Logger;
  timeZone: string;
}

/**
 * Push each user at most one digest per local day: follow-up nudges for applications that have
 * sat in one stage for a week, and saved jobs whose posting closed. The day is claimed before
 * anything is sent, so a crash or second instance never doubles up (at worst it skips a day).
 * Pushes use the LINE monthly quota, which is why it's one combined message a day at most.
 */
export async function runDigest(
  deps: DigestDeps,
  now = new Date(),
): Promise<{ users: number; sent: number; failed: number }> {
  const { digests, line, logger, timeZone } = deps;
  const hour = localParts(now, timeZone).hour;
  if (hour < DIGEST_FROM_HOUR || hour >= DIGEST_UNTIL_HOUR) return { users: 0, sent: 0, failed: 0 };

  const users = await digests.dueUsers(now, timeZone, USERS_PER_RUN);
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    if (!(await digests.claimUser(u.userId, now, timeZone))) continue;
    const followUps = await digests.claimFollowUps(u.userId, now, timeZone);
    const closed = await digests.claimClosed(u.userId, now);
    if (followUps.length === 0 && closed.length === 0) continue;
    try {
      await line.push(u.lineUserId, digestMessages(followUps, closed, now, timeZone));
      sent++;
    } catch (err) {
      failed++;
      logger.error('Daily digest push failed', { userId: u.userId, ...errorFields(err) });
    }
  }
  if (sent || failed) logger.info('Daily digest', { users: users.length, sent, failed });
  return { users: users.length, sent, failed };
}

export function startDigestScheduler(deps: DigestDeps, intervalMs: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Keep going while a full page came back (many users due at once).
      for (let i = 0; i < 20; i++) {
        const r = await runDigest(deps);
        if (r.users < USERS_PER_RUN) break;
      }
    } catch (err) {
      deps.logger.error('Daily digest crashed', errorFields(err));
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
