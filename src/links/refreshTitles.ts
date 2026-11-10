import type { JobRepository } from '../jobs/repository.js';
import type { Logger } from '../lib/logger.js';
import { errorFields } from '../lib/logger.js';
import { looksUnsplit, placeholderTitle, type LinkPreviewer } from './preview.js';

export interface RefreshDeps {
  jobs: Pick<JobRepository, 'listLinkJobs' | 'rename'>;
  previewLink: LinkPreviewer;
  logger: Logger;
}

export interface RefreshOptions {
  /** At most this many links are read per run. */
  limit?: number;
  /** Pause between page reads, to stay gentle with the sites. */
  delayMs?: number;
}

/**
 * Link jobs saved before we could read JobThai / JobsDB / JobBKK pages kept the board's whole
 * page title ("JobThai - งาน หางาน สมัครงาน…") as the position and the host as the company.
 * Read each such link once more and store the position and company properly; when the page
 * still says nothing useful, fall back to the placeholder so the user can rename it.
 */
export async function refreshLinkTitles(
  deps: RefreshDeps,
  opts: RefreshOptions = {},
): Promise<{ checked: number; renamed: number }> {
  const { limit = 50, delayMs = 1500 } = opts;
  const all = await deps.jobs.listLinkJobs();
  const stale = all
    .filter((j) => j.title !== placeholderTitle(j.board) && looksUnsplit(j))
    .slice(0, limit);

  let renamed = 0;
  for (const [i, job] of stale.entries()) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const preview = await deps.previewLink(job.url);
      const title = preview.title ?? placeholderTitle(job.board);
      const company = preview.company ?? undefined;
      if (title === job.title && (company ?? job.company) === job.company) continue;
      await deps.jobs.rename(job.id, title, company);
      renamed++;
    } catch (err) {
      deps.logger.warn('Could not refresh link title', { jobId: job.id, ...errorFields(err) });
    }
  }
  if (stale.length)
    deps.logger.info('Refreshed link job titles', { checked: stale.length, renamed });
  return { checked: stale.length, renamed };
}
