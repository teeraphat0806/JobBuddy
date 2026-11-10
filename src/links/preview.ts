import { cleanLocation, workplaceFromText } from '../jobs/location.js';
import { getJson, LEVER_WORKPLACE, str, USER_AGENT, type Fetch } from '../jobs/providers.js';
import type { Provider, Workplace } from '../jobs/types.js';
import { JOB_SOURCES } from '../jobs/sources.js';
import { safeFetchHtml, type FetchedPage } from './safeFetch.js';

/** What we could learn about a job from a link the user sent. */
export interface LinkPreview {
  /** The link, cleaned of tracking parameters. */
  url: string;
  title: string | null;
  company: string | null;
  location: string;
  department: string | null;
  workplace: Workplace | null;
  /** Set when the link is a posting on a job board we sync from. */
  source?: { provider: Provider; board: string; externalId: string };
}

export type LinkPreviewer = (url: string) => Promise<LinkPreview>;

const MAX_URL = 1000; // LINE URI actions can't be longer than this.

/** First http(s) URL in a message, without trailing punctuation. */
export function extractUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>"'“”]+/i.exec(text);
  if (!m) return null;
  return m[0].replace(/[),.;:!?\]}>）。、]+$/u, '');
}

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|igshid|mc_\w+|trk\w*|refid|trackingid|ref|src)$/i;

/** Normalised link: no fragment or tracking params. null if unusable. */
export function canonicalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  const out = url.toString();
  return out.length <= MAX_URL ? out : null;
}

// ---- Postings on the ATS boards we already know how to read.

export interface AtsRef {
  provider: Provider;
  board: string;
  id: string;
}

export function atsRefOf(rawUrl: string): AtsRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    if (parts[0] === 'embed') {
      const board = url.searchParams.get('for');
      const id = url.searchParams.get('token');
      return board && id ? { provider: 'greenhouse', board, id } : null;
    }
    if (parts.length >= 3 && parts[1] === 'jobs' && /^\d+$/.test(parts[2]!)) {
      return { provider: 'greenhouse', board: parts[0]!, id: parts[2]! };
    }
  }
  if (host === 'jobs.lever.co' && parts.length >= 2 && /^[0-9a-f-]{36}$/i.test(parts[1]!)) {
    return { provider: 'lever', board: parts[0]!, id: parts[1]! };
  }
  if (host === 'jobs.smartrecruiters.com' && parts.length >= 2) {
    const id = /^(\d+)/.exec(parts[1]!)?.[1];
    if (id) return { provider: 'smartrecruiters', board: parts[0]!, id };
  }
  return null;
}

/** Display name for boards we sync from (Lever's API doesn't return one). */
const knownCompany = (ref: AtsRef) =>
  JOB_SOURCES.find((s) => s.provider === ref.provider && s.board === ref.board)?.company ?? null;

type AtsDetails = Omit<LinkPreview, 'url' | 'source'>;

async function fetchAtsDetails(ref: AtsRef, fetchImpl: Fetch): Promise<AtsDetails> {
  const b = encodeURIComponent(ref.board);
  const id = encodeURIComponent(ref.id);
  switch (ref.provider) {
    case 'greenhouse': {
      const j = (await getJson(
        fetchImpl,
        `https://boards-api.greenhouse.io/v1/boards/${b}/jobs/${id}`,
      )) as { title?: string; company_name?: string; location?: { name?: string } };
      const location = cleanLocation(j.location?.name ?? '');
      return {
        title: str(j.title),
        company: str(j.company_name),
        location,
        department: null,
        workplace: workplaceFromText(location),
      };
    }
    case 'lever': {
      const j = (await getJson(fetchImpl, `https://api.lever.co/v0/postings/${b}/${id}`)) as {
        text?: string;
        workplaceType?: string;
        categories?: { location?: string; team?: string; department?: string };
      };
      const location = cleanLocation(j.categories?.location ?? '');
      return {
        title: str(j.text),
        company: knownCompany(ref),
        location,
        department: str(j.categories?.department) ?? str(j.categories?.team),
        workplace:
          LEVER_WORKPLACE[j.workplaceType?.toLowerCase() ?? ''] ?? workplaceFromText(location),
      };
    }
    case 'smartrecruiters': {
      const j = (await getJson(
        fetchImpl,
        `https://api.smartrecruiters.com/v1/companies/${b}/postings/${id}`,
      )) as {
        name?: string;
        company?: { name?: string };
        location?: { fullLocation?: string; city?: string; remote?: boolean; hybrid?: boolean };
        department?: { label?: string };
      };
      const loc = j.location ?? {};
      return {
        title: str(j.name),
        company: str(j.company?.name),
        location: cleanLocation(loc.fullLocation ?? loc.city ?? ''),
        department: str(j.department?.label),
        workplace: loc.remote ? 'remote' : loc.hybrid ? 'hybrid' : null,
      };
    }
  }
}

// ---- Any other page: read only its title / Open Graph tags.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

const clean = (s: string | undefined | null) =>
  s ? decodeEntities(s).replace(/\s+/g, ' ').trim() || null : null;

export function parseHtmlMeta(html: string): { title: string | null; siteName: string | null } {
  const head = html.slice(0, 200_000);
  const meta = new Map<string, string>();
  for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs.set(a[1]!.toLowerCase(), a[2] ?? a[3] ?? '');
    }
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase();
    const content = attrs.get('content');
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag),
    siteName: clean(meta.get('og:site_name') ?? meta.get('application-name')),
  };
}

/** Page titles that tell us nothing about the job (login walls, bot checks...). */
const USELESS_TITLE =
  /^(sign ?in|sign ?up|log ?in|just a moment|access denied|attention required|เข้าสู่ระบบ|403|404|error)\b/i;

/** Job boards whose site name isn't the hiring company. */
const JOB_BOARDS = /linkedin|jobsdb|jobthai|indeed|glassdoor|jobtopgun|jobbkk|seek|workday/i;

export function hostLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

export function previewFromHtml(page: FetchedPage): Omit<LinkPreview, 'url'> {
  const { title: rawTitle, siteName } = parseHtmlMeta(page.html);
  const empty = { location: '', department: null, workplace: null };

  // LinkedIn: "Acme hiring Data Analyst in Bangkok, Thailand | LinkedIn"
  const li = rawTitle && /^(.+?) hiring (.+?) in (.+?)(?:\s*\|\s*LinkedIn)?$/i.exec(rawTitle);
  if (li) {
    const location = cleanLocation(li[3]!);
    return {
      title: li[2]!.trim(),
      company: li[1]!.trim(),
      location,
      department: null,
      workplace: workplaceFromText(location),
    };
  }

  let title = rawTitle;
  if (title && siteName) {
    // "Data Analyst | Acme Careers" -> "Data Analyst" when the suffix is the site's name.
    const parts = title.split(/\s+[|–—-]\s+/);
    if (parts.length > 1 && parts.at(-1)!.toLowerCase() === siteName.toLowerCase()) {
      title = parts.slice(0, -1).join(' - ');
    }
  }
  if (title && (USELESS_TITLE.test(title) || title.toLowerCase() === siteName?.toLowerCase())) {
    title = null;
  }
  const company = siteName && !JOB_BOARDS.test(siteName) ? siteName : null;
  return { title: title ? [...title].slice(0, 200).join('') : null, company, ...empty };
}

export interface PreviewDeps {
  fetchImpl?: Fetch;
  fetchHtml?: (url: string) => Promise<FetchedPage | null>;
}

/** Learn what we can about a job link. Never throws for network problems. */
export function createLinkPreviewer(deps: PreviewDeps = {}): LinkPreviewer {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchHtml =
    deps.fetchHtml ??
    ((url: string) =>
      safeFetchHtml(url, {
        userAgent: `Mozilla/5.0 (compatible; ${USER_AGENT})`,
      }));

  return async (url) => {
    const unknown: LinkPreview = {
      url,
      title: null,
      company: null,
      location: '',
      department: null,
      workplace: null,
    };
    const ref = atsRefOf(url);
    if (ref) {
      const source = { provider: ref.provider, board: ref.board, externalId: ref.id };
      try {
        return { url, source, ...(await fetchAtsDetails(ref, fetchImpl)) };
      } catch {
        return { ...unknown, source };
      }
    }
    try {
      const page = await fetchHtml(url);
      return page ? { url, ...previewFromHtml(page) } : unknown;
    } catch {
      return unknown;
    }
  };
}
