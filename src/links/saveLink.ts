import type { Job } from '../db/schema.js';
import {
  LINK_PROVIDER,
  type JobRepository,
  type UserJobEntry,
  type UserJobRepository,
} from '../jobs/repository.js';
import { canonicalUrl, hostLabel, placeholderTitle, type LinkPreviewer } from './preview.js';

export interface TrackedLink {
  /** 'new' = just saved; 'saved' / 'applied' = was already in that list (a duplicate). */
  kind: 'new' | 'saved' | 'applied';
  job: Job;
  entry: UserJobEntry;
  /** The page gave no title, so the job has the placeholder one. */
  needsTitle: boolean;
}
export type SavedLink = { kind: 'invalid'; raw: string } | TrackedLink;
export type LinkSaver = (userId: string, rawUrl: string) => Promise<SavedLink>;

export const isPlaceholder = (job: Job) =>
  job.provider === LINK_PROVIDER && job.title === placeholderTitle(job.board);

/** Find or create the job behind one link and make sure it's in the user's saved list. */
export function createLinkSaver(deps: {
  jobs: JobRepository;
  userJobs: UserJobRepository;
  previewLink: LinkPreviewer;
}): LinkSaver {
  const { jobs, userJobs } = deps;
  return async (userId, rawUrl) => {
    const url = canonicalUrl(rawUrl);
    if (!url) return { kind: 'invalid', raw: rawUrl };

    let job = await jobs.findByUrl(url);
    if (!job) {
      const preview = await deps.previewLink(url);
      if (preview.source) {
        const { provider, board, externalId } = preview.source;
        job = await jobs.findBySource(provider, board, externalId);
      }
      if (!job) {
        const host = hostLabel(url);
        job = await jobs.createLinkJob({
          board: host,
          externalId: url,
          company: preview.company ?? preview.source?.board ?? host,
          title: preview.title ?? placeholderTitle(host),
          location: preview.location,
          department: preview.department,
          workplace: preview.workplace,
          url,
        });
      }
    }
    const needsTitle = isPlaceholder(job);
    const entry = await userJobs.get(userId, job.id);
    if (entry?.status === 'applied' || entry?.status === 'saved') {
      return { kind: entry.status, job, entry, needsTitle };
    }
    await userJobs.setStatus(userId, job.id, 'saved');
    return {
      kind: 'new',
      job,
      entry: { status: 'saved', stage: null, stageSince: null },
      needsTitle,
    };
  };
}
