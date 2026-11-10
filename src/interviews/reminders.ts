import type { Logger } from '../lib/logger.js';
import { errorFields } from '../lib/logger.js';
import { reminderMessage } from '../line/interviews.js';
import type { LineMessenger } from '../line/messenger.js';
import type { InterviewRepository } from './repository.js';
import { decideReminder } from './time.js';

/** Covers the evening-before reminder (≤ ~29h ahead) with room to spare. */
const LOOKAHEAD_MS = 36 * 60 * 60 * 1000;

export interface ReminderDeps {
  interviews: InterviewRepository;
  line: Pick<LineMessenger, 'push'>;
  logger: Logger;
  timeZone: string;
}

/**
 * Push any interview reminders that are due. Each reminder is claimed in the database before
 * it is sent, so a crash or a second instance can never send it twice (at worst, never).
 * Push messages count against the LINE monthly quota.
 */
export async function runReminders(
  deps: ReminderDeps,
  now = new Date(),
): Promise<{ checked: number; sent: number; failed: number }> {
  const { interviews, line, logger, timeZone } = deps;
  const candidates = await interviews.reminderCandidates(
    now,
    new Date(now.getTime() + LOOKAHEAD_MS),
  );
  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    const decision = decideReminder(c.interview, now, timeZone);
    for (const kind of decision.skip) await interviews.claimReminder(c.interview.id, kind, now);
    if (!decision.send) continue;
    if (!(await interviews.claimReminder(c.interview.id, decision.send, now))) continue;
    try {
      await line.push(c.lineUserId, [
        reminderMessage(decision.send, c.interview, c.job, timeZone, now),
      ]);
      sent++;
    } catch (err) {
      failed++;
      logger.error('Interview reminder push failed', {
        interviewId: c.interview.id,
        kind: decision.send,
        ...errorFields(err),
      });
    }
  }
  if (sent || failed)
    logger.info('Interview reminders', { checked: candidates.length, sent, failed });
  return { checked: candidates.length, sent, failed };
}

export function startReminderScheduler(deps: ReminderDeps, intervalMs: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runReminders(deps);
    } catch (err) {
      deps.logger.error('Reminder run crashed', errorFields(err));
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
