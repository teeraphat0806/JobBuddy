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

const URL_PATTERN = /https?:\/\/[^\s<>"'“”]+/gi;
const trimUrl = (u: string) => u.replace(/[),.;:!?\]}>）。、]+$/u, '');

/** First http(s) URL in a message, without trailing punctuation. */
export function extractUrl(text: string): string | null {
  return extractUrls(text)[0] ?? null;
}

/** Every distinct http(s) URL in a message, in order. */
export function extractUrls(text: string): string[] {
  return [...new Set(extractAllUrls(text))];
}

/** Every http(s) URL in a message, in order, repeats included (so they can be reported). */
export function extractAllUrls(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)].map((m) => trimUrl(m[0]));
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
  // apply.workable.com/{account}/j/{shortcode}/
  if (host === 'apply.workable.com' && parts.length >= 3 && parts[1] === 'j') {
    return { provider: 'workable', board: parts[0]!, id: parts[2]! };
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
    case 'workable': {
      // The public widget lists every open job; pick the one the link points at.
      const body = (await getJson(
        fetchImpl,
        `https://apply.workable.com/api/v1/widget/accounts/${b}`,
      )) as {
        name?: string;
        jobs?: {
          shortcode?: string;
          title?: string;
          department?: string;
          telecommuting?: boolean;
          city?: string;
          country?: string;
        }[];
      };
      const j = body.jobs?.find((x) => x.shortcode === ref.id);
      const location = cleanLocation([j?.city, j?.country].filter(Boolean).join(', '));
      return {
        title: str(j?.title),
        company: str(body.name),
        location,
        department: str(j?.department),
        workplace: j?.telecommuting ? 'remote' : workplaceFromText(location),
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

export interface HtmlMeta {
  title: string | null;
  siteName: string | null;
  description: string | null;
}

export function parseHtmlMeta(html: string): HtmlMeta {
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
    description: clean(meta.get('description') ?? meta.get('og:description')),
  };
}

type Found = Omit<LinkPreview, 'url'>;

const found = (title: string, company: string | null, location = ''): Found => {
  const loc = location ? cleanLocation(location) : '';
  const c = company?.trim();
  return {
    title: [...title.trim()].slice(0, 200).join(''),
    company: c ? [...c].slice(0, 100).join('') : null,
    location: loc,
    department: null,
    workplace: workplaceFromText(loc),
  };
};

// ---- schema.org JobPosting (JSON-LD), which many job pages embed for search engines.

const LD_SCRIPT =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function parseLenient(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Some sites put raw newlines / tabs inside strings, which strict JSON rejects.
    try {
      // eslint-disable-next-line no-control-regex
      return JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return null;
    }
  }
}

function findJobPosting(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findJobPosting(n, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return obj;
  return findJobPosting(obj['@graph'], depth + 1);
}

function placeOf(jobLocation: unknown): string {
  const loc: unknown = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const address = (loc as { address?: unknown } | undefined)?.address;
  if (typeof address === 'string') return address;
  if (!address || typeof address !== 'object') return '';
  const a = address as Record<string, unknown>;
  const parts = [a.addressLocality, a.addressRegion]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return [...new Set(parts)].join(', ');
}

/** Title / company / place from an embedded schema.org JobPosting, if the page has one. */
export function jobPostingFromHtml(html: string): Found | null {
  for (const m of html.matchAll(LD_SCRIPT)) {
    const posting = findJobPosting(parseLenient(m[1]!.trim()));
    if (!posting) continue;
    const title = clean(str(posting.title));
    if (!title) continue;
    const org = posting.hiringOrganization;
    const company = clean(
      typeof org === 'string' ? org : str((org as { name?: unknown } | undefined)?.name),
    );
    return found(title, company, clean(placeOf(posting.jobLocation)) ?? '');
  }
  return null;
}

// ---- Thai job boards: we only read the one page the user sent us (like a chat link preview).

const SLOGAN = 'งาน หางาน สมัครงาน';

function fromJobThai(html: string, meta: HtmlMeta): Found | null {
  // Description: "งาน {company} ตำแหน่งงาน {position}" — the most reliable source.
  const d = meta.description && /^งาน\s+(.+?)\s+ตำแหน่งงาน\s+(.+?)\s*$/.exec(meta.description);
  if (d) return found(d[2]!, d[1]!);
  const t = meta.title ?? '';
  // /th/company/job/{id}: "งาน หางาน สมัครงาน {company} | {position} - JobThai"
  const a = new RegExp(`^${SLOGAN}\\s+(.+?)\\s+\\|\\s+(.+?)\\s+-\\s+JobThai$`, 'i').exec(t);
  if (a) return found(a[2]!, a[1]!);
  // /th/job/{id}: "{position} | {company} งาน หางาน สมัครงาน - JobThai"
  const b = new RegExp(`^(.+?)\\s+\\|\\s+(.+?)\\s+${SLOGAN}\\s+-\\s+JobThai$`, 'i').exec(t);
  if (b) return found(b[1]!, b[2]!);
  return jobPostingFromHtml(html);
}

function fromJobsDb(html: string, meta: HtmlMeta): Found | null {
  const body = html.slice(0, 1_000_000);
  const tagText = (attr: string) =>
    clean(
      new RegExp(`data-automation="${attr}"[^>]*>(?:\\s*<[^>]+>)*\\s*([^<]+)<`).exec(body)?.[1],
    );
  let company = tagText('advertiser-name');
  const jsonCompany = /"companyName"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1];
  if (!company && jsonCompany) {
    const decoded = parseLenient(`"${jsonCompany}"`);
    company = clean(typeof decoded === 'string' ? decoded : null);
  }
  // og:title: "{position} Job in {location} - Jobsdb"
  const og = meta.title ? /^(.+?) Job in (.+?)\s+-\s+Jobsdb\b.*$/i.exec(meta.title) : null;
  const title = tagText('job-detail-title') ?? og?.[1] ?? null;
  if (title) return found(title, company, og?.[2] ?? '');
  return jobPostingFromHtml(html);
}

function fromJobBkk(html: string, meta: HtmlMeta): Found | null {
  const ld = jobPostingFromHtml(html);
  if (ld?.company) return ld;
  // "{position} | {company} งาน หางาน สมัครงาน - jobbkk.com"
  const t = meta.title
    ? new RegExp(`^(.+?)\\s+\\|\\s+(.+?)\\s+${SLOGAN}.*jobbkk`, 'i').exec(meta.title)
    : null;
  if (t) return found(t[1]!, t[2]!);
  return ld;
}

const SITE_RULES: { host: RegExp; read: (html: string, meta: HtmlMeta) => Found | null }[] = [
  { host: /(^|\.)jobthai\.com$/i, read: fromJobThai },
  { host: /(^|\.)jobsdb\.com$/i, read: fromJobsDb },
  { host: /(^|\.)jobbkk\.com$/i, read: fromJobBkk },
];

/** Page titles that tell us nothing about the job (login walls, bot checks...). */
const USELESS_TITLE =
  /^(sign ?in|sign ?up|log ?in|just a moment|access denied|attention required|เข้าสู่ระบบ|403|404|error)\b/i;

/** Job boards whose site name isn't the hiring company. */
const JOB_BOARDS = /linkedin|jobsdb|jobthai|indeed|glassdoor|jobtopgun|jobbkk|seek|workday/i;

/**
 * A job board's own slogan rather than a posting ("JobThai - งาน หางาน สมัครงาน หาคน กว่า 200
 * อาชีพ…"): what a home page, search page or removed posting shows.
 */
const GENERIC_BOARD_TITLE =
  /^(jobthai|jobsdb|jobbkk|jobtopgun|indeed|linkedin)\b|^หางาน|หางาน\s*สมัครงาน|job ?search|find jobs/i;

/**
 * True when a saved link job still has a board's whole page title instead of a position and a
 * company (saved before the site rules existed), so it is worth reading the link again.
 */
export function looksUnsplit(job: { title: string; company: string; board: string }): boolean {
  if (!JOB_BOARDS.test(job.board)) return false;
  return (
    GENERIC_BOARD_TITLE.test(job.title) ||
    /\s-\s(JobThai|Jobsdb)\b|jobbkk\.com/i.test(job.title) ||
    job.company === job.board
  );
}

/** Title for a link job whose page we couldn't read; the user is asked to rename it. */
export const placeholderTitle = (host: string) => `งานจาก ${host}`;

export function hostLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

export function previewFromHtml(page: FetchedPage): Found {
  const meta = parseHtmlMeta(page.html);
  const { title: rawTitle, siteName } = meta;
  const empty = { location: '', department: null, workplace: null };

  let host = '';
  try {
    host = new URL(page.url).hostname;
  } catch {
    // no host: generic rules only
  }
  const rule = SITE_RULES.find((r) => r.host.test(host));
  if (rule) {
    const hit = rule.read(page.html, meta);
    if (hit?.title) return hit;
  }

  // LinkedIn: "Acme hiring Data Analyst in Bangkok, Thailand | LinkedIn"
  const li = rawTitle && /^(.+?) hiring (.+?) in (.+?)(?:\s*\|\s*LinkedIn)?$/i.exec(rawTitle);
  if (li) return found(li[2]!, li[1]!, li[3]!);

  const ld = jobPostingFromHtml(page.html);
  if (ld) return ld;

  let title = rawTitle;
  if (title && siteName) {
    // "Data Analyst | Acme Careers" -> "Data Analyst" when the suffix is the site's name.
    const parts = title.split(/\s+[|–—-]\s+/);
    if (parts.length > 1 && parts.at(-1)!.toLowerCase() === siteName.toLowerCase()) {
      title = parts.slice(0, -1).join(' - ');
    }
  }
  const onBoard = JOB_BOARDS.test(host) || (siteName !== null && JOB_BOARDS.test(siteName));
  if (
    title &&
    (USELESS_TITLE.test(title) ||
      title.toLowerCase() === siteName?.toLowerCase() ||
      (onBoard && GENERIC_BOARD_TITLE.test(title)))
  ) {
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
