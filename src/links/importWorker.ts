import type { Logger } from '../lib/logger.js';
import { errorFields } from '../lib/logger.js';
import type { LineMessenger, OutgoingMessage } from '../line/messenger.js';
import { postbackButton, text } from '../line/ui.js';
import type {
  ClaimedImport,
  ImportOutcome,
  ImportSummary,
  LinkImportRepository,
} from './importRepository.js';
import type { LinkSaver } from './saveLink.js';

/** Links taken from the queue per round. */
const CLAIM_SIZE = 20;
/** Sites worked on at the same time. */
const SITE_CONCURRENCY = 4;
/** Newly saved jobs listed by name in the summary. */
const SUMMARY_NAMES = 15;
const LINE_TEXT_MAX = 5000;

export interface ImportWorkerDeps {
  imports: LinkImportRepository;
  saveLink: LinkSaver;
  line: Pick<LineMessenger, 'push'>;
  logger: Logger;
  /** Gap between two page reads on the same site: we read pages one at a time, never in bursts. */
  perSiteIntervalMs?: number;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** The push sent once everything a user queued has been processed. */
export function importSummaryMessage(s: ImportSummary): OutgoingMessage {
  const { counts } = s;
  const lines = [`📥 บันทึกลิงก์เสร็จแล้วครับ (ได้รับ ${s.total} ลิงก์)`];
  if (counts.new) {
    lines.push(`✅ บันทึกใหม่ ${counts.new} งาน ใน ⭐ ที่เก็บไว้`);
    for (const j of s.newJobs) lines.push(`• ${j.title} @ ${j.company}`);
    if (counts.new > s.newJobs.length) lines.push(`…และอีก ${counts.new - s.newJobs.length} งาน`);
  } else {
    lines.push('ไม่มีงานใหม่ให้บันทึกครับ');
  }
  const duplicates = counts.duplicate + s.repeated;
  if (duplicates) lines.push('', `🔁 ลิงก์ซ้ำ ${duplicates} ลิงก์ (ไม่ได้บันทึกซ้ำ)`);
  if (counts.invalid) lines.push('', `⚠️ ใช้ไม่ได้ ${counts.invalid} ลิงก์`);
  if (counts.failed)
    lines.push('', `❌ บันทึกไม่สำเร็จ ${counts.failed} ลิงก์ — ลองส่งใหม่อีกครั้งได้`);
  return text([...lines.join('\n')].slice(0, LINE_TEXT_MAX).join(''), [
    postbackButton('⭐ ดูที่เก็บไว้', { a: 'menu', m: 'saved' }),
  ]);
}

/**
 * Saves queued links in the background: a few sites at a time, one page at a time per site,
 * then pushes a single summary per user (pushes use the LINE monthly quota).
 */
export function createLinkImportWorker(deps: ImportWorkerDeps) {
  const interval = deps.perSiteIntervalMs ?? 1000;
  const nextSlot = new Map<string, number>();

  /** Waits for this site's next free slot, reserving it first so parallel callers queue up. */
  async function waitForSite(host: string) {
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + interval);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  async function processOne(item: ClaimedImport) {
    let outcome: ImportOutcome = 'failed';
    let jobId: string | null = null;
    try {
      const host = hostOf(item.url);
      if (host) await waitForSite(host);
      const saved = await deps.saveLink(item.userId, item.url);
      if (saved.kind === 'invalid') outcome = 'invalid';
      else {
        outcome = saved.kind === 'new' ? 'new' : 'duplicate';
        jobId = saved.job.id;
      }
    } catch (err) {
      deps.logger.warn('Queued link failed', { importId: item.id, ...errorFields(err) });
    }
    await deps.imports.finish(item.id, outcome, jobId);
  }

  async function notify() {
    const summaries = await deps.imports.takeFinished(SUMMARY_NAMES);
    for (const s of summaries) {
      try {
        await deps.line.push(s.lineUserId, [importSummaryMessage(s)]);
      } catch (err) {
        deps.logger.warn('Import summary push failed', { userId: s.userId, ...errorFields(err) });
      }
    }
    return summaries.length;
  }

  /** One round: claim some links, save them, report users who are done. */
  async function runOnce(): Promise<{ processed: number; notified: number }> {
    const claimed = await deps.imports.claim(CLAIM_SIZE);
    const bySite = new Map<string, ClaimedImport[]>();
    for (const c of claimed) {
      const host = hostOf(c.url);
      bySite.set(host, [...(bySite.get(host) ?? []), c]);
    }
    const sites = [...bySite.values()];
    // Each lane works through whole sites, so a site never gets two requests at once.
    await Promise.all(
      Array.from({ length: Math.min(SITE_CONCURRENCY, sites.length) }, async () => {
        for (let site = sites.shift(); site; site = sites.shift()) {
          for (const item of site) await processOne(item);
        }
      }),
    );
    const notified = await notify();
    return { processed: claimed.length, notified };
  }

  /** Runs until the queue is empty. Safe to call often: overlapping calls share one run. */
  let running: Promise<void> | null = null;
  function drain(): Promise<void> {
    running ??= (async () => {
      try {
        while ((await runOnce()).processed > 0) {
          // keep going while there is work
        }
      } catch (err) {
        deps.logger.error('Link import run crashed', errorFields(err));
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** Checks the queue every `intervalMs` (picks up work left by a restart); `kick` starts now. */
  function start(intervalMs: number) {
    void drain();
    const timer = setInterval(() => void drain(), intervalMs);
    timer.unref();
    return { stop: () => clearInterval(timer), kick: () => void drain() };
  }

  return { runOnce, drain, start };
}
