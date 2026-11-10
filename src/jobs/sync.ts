import { errorFields, type Logger } from '../lib/logger.js';
import { fetchSource, type Fetch } from './providers.js';
import type { JobRepository } from './repository.js';
import type { JobSource } from './types.js';

export interface SyncSummary {
  sources: number;
  failed: string[];
  listings: number;
  deactivated: number;
}

/**
 * Pull every source and upsert its Thai postings. A source that fails is skipped
 * *without* deactivating its jobs, so a flaky API never wipes out real postings.
 */
export async function runJobSync(
  repo: JobRepository,
  sources: JobSource[],
  logger: Logger,
  options: { fetchImpl?: Fetch; now?: () => Date } = {},
): Promise<SyncSummary> {
  const now = options.now ?? (() => new Date());
  const summary: SyncSummary = { sources: sources.length, failed: [], listings: 0, deactivated: 0 };

  for (const source of sources) {
    const label = `${source.provider}/${source.board}`;
    try {
      const seenAt = now();
      const listings = await fetchSource(source, options.fetchImpl);
      await repo.upsertListings(listings, seenAt);
      summary.deactivated += await repo.deactivateMissing(source.provider, source.board, seenAt);
      summary.listings += listings.length;
    } catch (err) {
      summary.failed.push(label);
      logger.warn('Job source sync failed', { source: label, ...errorFields(err) });
    }
  }

  logger.info('Job sync finished', { ...summary });
  return summary;
}

/**
 * Run the sync now if data is stale, then every `intervalMs`. Single-instance only:
 * overlapping runs in this process are skipped.
 */
export function startJobSyncScheduler(
  repo: JobRepository,
  sources: JobSource[],
  logger: Logger,
  intervalMs: number,
): () => void {
  let running = false;
  const tick = async (force: boolean) => {
    if (running) return;
    running = true;
    try {
      const last = await repo.lastSyncedAt();
      if (force || !last || Date.now() - last.getTime() >= intervalMs * 0.9) {
        await runJobSync(repo, sources, logger);
      } else {
        logger.info('Job data fresh; skipping startup sync', { lastSyncedAt: last.toISOString() });
      }
    } catch (err) {
      logger.error('Job sync crashed', errorFields(err));
    } finally {
      running = false;
    }
  };

  void tick(false);
  const timer = setInterval(() => void tick(true), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
