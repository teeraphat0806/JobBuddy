import { cleanLocation, isInThailand, workplaceFromText } from './location.js';
import type { JobListing, JobSource, Workplace } from './types.js';

/**
 * Fetchers for public ATS job-board APIs. These endpoints are published by the
 * providers specifically so postings can be listed elsewhere; we keep only a summary
 * and always link back to the original posting.
 */
export type Fetch = typeof fetch;

const USER_AGENT = 'JobBuddy/0.1 (+https://github.com/teeraphat0806/JobBuddy)';
const TIMEOUT_MS = 20_000;

async function getJson(fetchImpl: Fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.json();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---- Greenhouse: GET boards-api.greenhouse.io/v1/boards/{board}/jobs

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  company_name?: string;
  first_published?: string;
  updated_at?: string;
}

export async function fetchGreenhouse(source: JobSource, fetchImpl: Fetch): Promise<JobListing[]> {
  const body = (await getJson(
    fetchImpl,
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs`,
  )) as { jobs?: GreenhouseJob[] };
  return (body.jobs ?? []).flatMap((j) => {
    const location = cleanLocation(j.location?.name ?? '');
    if (!isInThailand(location) || !str(j.title) || !str(j.absolute_url)) return [];
    return [
      {
        provider: 'greenhouse' as const,
        board: source.board,
        externalId: String(j.id),
        company: str(j.company_name) ?? source.company,
        title: j.title.trim(),
        location,
        department: null,
        workplace: workplaceFromText(location),
        url: j.absolute_url,
        postedAt: date(j.first_published) ?? date(j.updated_at),
      },
    ];
  });
}

// ---- Lever: GET api.lever.co/v0/postings/{board}?mode=json

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[]; team?: string; department?: string };
}

const LEVER_WORKPLACE: Record<string, Workplace> = {
  onsite: 'onsite',
  'on-site': 'onsite',
  hybrid: 'hybrid',
  remote: 'remote',
};

export async function fetchLever(source: JobSource, fetchImpl: Fetch): Promise<JobListing[]> {
  const body = (await getJson(
    fetchImpl,
    `https://api.lever.co/v0/postings/${encodeURIComponent(source.board)}?mode=json`,
  )) as LeverJob[];
  if (!Array.isArray(body)) return [];
  return body.flatMap((j) => {
    const places = j.categories?.allLocations?.length
      ? j.categories.allLocations
      : [j.categories?.location ?? ''];
    const location = cleanLocation(places.join(', '));
    const inThailand = j.country?.toUpperCase() === 'TH' || isInThailand(location);
    if (!inThailand || !str(j.text) || !str(j.hostedUrl)) return [];
    return [
      {
        provider: 'lever' as const,
        board: source.board,
        externalId: j.id,
        company: source.company,
        title: j.text.trim(),
        location: isInThailand(location) ? location : `${location}, Thailand`.replace(/^, /, ''),
        department: str(j.categories?.department) ?? str(j.categories?.team),
        workplace:
          LEVER_WORKPLACE[j.workplaceType?.toLowerCase() ?? ''] ?? workplaceFromText(location),
        url: j.hostedUrl,
        postedAt: date(j.createdAt),
      },
    ];
  });
}

// ---- SmartRecruiters: GET api.smartrecruiters.com/v1/companies/{board}/postings?country=th

interface SmartRecruitersJob {
  id: string;
  name: string;
  releasedDate?: string;
  company?: { identifier?: string; name?: string };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    fullLocation?: string;
    remote?: boolean;
    hybrid?: boolean;
  };
  department?: { label?: string };
  function?: { label?: string };
}

const SR_PAGE = 100;
const SR_MAX_PAGES = 10;

export async function fetchSmartRecruiters(
  source: JobSource,
  fetchImpl: Fetch,
): Promise<JobListing[]> {
  const out: JobListing[] = [];
  for (let page = 0; page < SR_MAX_PAGES; page++) {
    const url =
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.board)}/postings` +
      `?country=th&limit=${SR_PAGE}&offset=${page * SR_PAGE}`;
    const body = (await getJson(fetchImpl, url)) as {
      content?: SmartRecruitersJob[];
      totalFound?: number;
    };
    const content = body.content ?? [];
    for (const j of content) {
      const loc = j.location ?? {};
      const location = cleanLocation(
        loc.fullLocation ?? [loc.city, loc.region, 'Thailand'].join(','),
      );
      if (!str(j.name) || (loc.country && loc.country.toLowerCase() !== 'th')) continue;
      out.push({
        provider: 'smartrecruiters',
        board: source.board,
        externalId: j.id,
        company: str(j.company?.name) ?? source.company,
        title: j.name.trim(),
        location: location || 'Thailand',
        department: str(j.department?.label) ?? str(j.function?.label),
        workplace: loc.remote ? 'remote' : loc.hybrid ? 'hybrid' : 'onsite',
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(source.board)}/${encodeURIComponent(j.id)}`,
        postedAt: date(j.releasedDate),
      });
    }
    if (content.length < SR_PAGE || (page + 1) * SR_PAGE >= (body.totalFound ?? 0)) break;
  }
  return out;
}

export function fetchSource(source: JobSource, fetchImpl: Fetch = fetch): Promise<JobListing[]> {
  switch (source.provider) {
    case 'greenhouse':
      return fetchGreenhouse(source, fetchImpl);
    case 'lever':
      return fetchLever(source, fetchImpl);
    case 'smartrecruiters':
      return fetchSmartRecruiters(source, fetchImpl);
  }
}
