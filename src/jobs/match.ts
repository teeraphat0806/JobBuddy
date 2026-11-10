import type { PrefsInput } from '../prefs/types.js';
import { isCountryOnly, placeTerms } from './location.js';
import { expandRole } from './synonyms.js';
import type { Workplace } from './types.js';

/** The fields of a job that matching looks at. */
export interface MatchableJob {
  id: string;
  title: string;
  company: string;
  location: string;
  department: string | null;
  workplace: Workplace | null;
  postedAt: Date | null;
  firstSeenAt: Date;
}

export const MIN_SCORE = 40;

/** Words that don't say what the job *is*, so they shouldn't drive a partial match. */
const NOISE = new Set([
  'senior',
  'sr',
  'junior',
  'jr',
  'lead',
  'principal',
  'staff',
  'head',
  'of',
  'and',
  '&',
  '-',
  'the',
  'a',
  'i',
  'ii',
  'iii',
  'associate',
  'assistant',
  'specialist',
  'officer',
  'executive',
  'manager',
  'intern',
  'th',
  'thailand',
  'bangkok',
  'based',
]);

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean);

/** 0–100: how well a job title (and department) matches one phrase. */
function phraseScore(phrase: string, title: string, department: string): number {
  const t = title.toLowerCase();
  if (t.includes(phrase)) return 100;

  const titleWords = new Set(words(title));
  const significant = words(phrase).filter((w) => !NOISE.has(w));
  if (significant.length === 0) return 0;
  const hits = significant.filter((w) => titleWords.has(w)).length;
  if (hits === significant.length) return 80;

  const fraction = hits / significant.length;
  const partial = fraction >= 0.5 ? Math.round(60 * fraction) : 0;
  const dept = department && department.toLowerCase().includes(phrase) ? 50 : 0;
  return Math.max(partial, dept);
}

/** A hit on a synonym counts for less than a hit on what the user actually typed. */
const SYNONYM_WEIGHT = 0.85;

function roleScore(job: MatchableJob, positions: string[]): number {
  let best = 0;
  for (const role of positions) {
    expandRole(role).forEach((phrase, i) => {
      const weight = i === 0 ? 1 : SYNONYM_WEIGHT;
      best = Math.max(
        best,
        Math.round(weight * phraseScore(phrase, job.title, job.department ?? '')),
      );
    });
    if (best === 100) return best;
  }
  return best;
}

function locationOk(job: MatchableJob, places: string[]): { ok: boolean; factor: number } {
  if (places.length === 0) return { ok: true, factor: 1 };
  if (job.workplace === 'remote') return { ok: true, factor: 1 };
  const loc = job.location.toLowerCase();
  if (places.some((p) => placeTerms(p).some((term) => loc.includes(term))))
    return { ok: true, factor: 1 };
  // "Thailand" with no city could be anywhere: keep it, but rank lower.
  if (isCountryOnly(job.location)) return { ok: true, factor: 0.7 };
  return { ok: false, factor: 0 };
}

function workModeFactor(job: MatchableJob, mode: PrefsInput['workMode']): number {
  const w = job.workplace;
  switch (mode) {
    case 'any':
      return 1;
    case 'remote':
      // Unknown workplace is almost always an office job on these boards, so leave it out.
      return w === 'remote' ? 1 : w === 'hybrid' ? 0.7 : 0;
    case 'hybrid':
      return w === 'onsite' ? 0.8 : 1;
    case 'onsite':
      return w === 'remote' ? 0 : 1;
  }
}

function isExcluded(job: MatchableJob, excluded: string[]): boolean {
  if (excluded.length === 0) return false;
  const haystack = `${job.title} ${job.company} ${job.department ?? ''}`.toLowerCase();
  return excluded.some((k) => haystack.includes(k.toLowerCase()));
}

const DAY = 24 * 60 * 60 * 1000;

function recencyBonus(job: MatchableJob, now: Date): number {
  const ref = job.postedAt ?? job.firstSeenAt;
  const age = now.getTime() - ref.getTime();
  if (age <= 3 * DAY) return 10;
  if (age <= 14 * DAY) return 5;
  return 0;
}

/** Score a job for a user, or null if it shouldn't be shown at all. */
export function scoreJob(job: MatchableJob, prefs: PrefsInput, now = new Date()): number | null {
  if (isExcluded(job, prefs.excludedKeywords)) return null;
  const loc = locationOk(job, prefs.locations);
  if (!loc.ok) return null;
  const mode = workModeFactor(job, prefs.workMode);
  if (mode === 0) return null;
  const role = roleScore(job, prefs.positions);
  if (role === 0) return null;
  const score = Math.round(role * loc.factor * mode) + recencyBonus(job, now);
  return score >= MIN_SCORE ? score : null;
}

export interface RankedJob<J extends MatchableJob> {
  job: J;
  score: number;
  isNew: boolean;
}

/** Jobs matching the prefs, best first; `skip` holds job ids the user already acted on. */
export function rankJobs<J extends MatchableJob>(
  jobs: J[],
  prefs: PrefsInput,
  skip: Set<string>,
  now = new Date(),
): RankedJob<J>[] {
  const ranked: RankedJob<J>[] = [];
  for (const job of jobs) {
    if (skip.has(job.id)) continue;
    const score = scoreJob(job, prefs, now);
    if (score === null) continue;
    // Prefer the board's own posting date: on our first sync every job is "first seen" today.
    const ref = job.postedAt ?? job.firstSeenAt;
    ranked.push({ job, score, isNew: now.getTime() - ref.getTime() <= 3 * DAY });
  }
  const time = (j: MatchableJob) => (j.postedAt ?? j.firstSeenAt).getTime();
  return ranked.sort(
    (a, b) => b.score - a.score || time(b.job) - time(a.job) || a.job.id.localeCompare(b.job.id),
  );
}
