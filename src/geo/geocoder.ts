import type { Point } from './distance.js';

export interface GeocodeResult extends Point {
  /** What was matched, e.g. "เขตห้วยขวาง, กรุงเทพมหานคร". */
  label: string;
}

/** Turns a place name into coordinates; null when not found or too coarse to be useful. */
export type Geocoder = (query: string) => Promise<GeocodeResult | null>;

/**
 * Normalised lookup key for a job's location text, or null when there is nothing to look up
 * (empty, remote, or just the country). "Huai Khwang, Bangkok; Remote" -> "huai khwang, bangkok".
 */
export function geoQuery(location: string): string | null {
  const first = location.split(/;|\||\n|\s\/\s|\s+or\s+|\s+หรือ\s+/i)[0] ?? '';
  const cleaned = first
    .replace(/\b(thailand|th)\b|ประเทศไทย|(^|,)\s*ไทย\s*$/gi, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[\s,]+$/g, '')
    .replace(/^[\s,]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*(,\s*)*/g, ', ')
    .trim()
    .toLowerCase();
  if (!cleaned || /^(remote|anywhere|work from home|wfh|hybrid|onsite|on-site)$/.test(cleaned)) {
    return null;
  }
  return [...cleaned].slice(0, 200).join('');
}

/**
 * Nominatim place_rank: 4 country, 8 province (Bangkok is 7), 12 district (เขต / อำเภอ),
 * 16+ sub-district, town and finer. A whole province says nothing useful about a commute.
 */
const MIN_PLACE_RANK = 12;

interface NominatimHit {
  lat?: string;
  lon?: string;
  place_rank?: number;
  display_name?: string;
}

export interface NominatimOptions {
  baseUrl?: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  /** Nominatim's usage policy allows at most one request per second. */
  minIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * OpenStreetMap Nominatim, one request at a time and at most one per second, as its usage
 * policy asks. Only public job-location text is ever sent, never anything about the user.
 * Results must be cached by the caller.
 */
export function createNominatimGeocoder(opts: NominatimOptions): Geocoder {
  const baseUrl = (opts.baseUrl ?? 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const minInterval = opts.minIntervalMs ?? 1100;
  const timeoutMs = opts.timeoutMs ?? 8000;
  let queue: Promise<unknown> = Promise.resolve();
  let lastAt = 0;

  async function search(q: string): Promise<NominatimHit | null> {
    const wait = lastAt + minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const url = new URL(`${baseUrl}/search`);
    url.search = new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: '1',
      countrycodes: 'th',
      'accept-language': 'th',
    }).toString();
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': opts.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    return Array.isArray(body) && body[0] ? (body[0] as NominatimHit) : null;
  }

  async function lookup(query: string): Promise<GeocodeResult | null> {
    // "บางเสาธง, สมุทรปราการ" sometimes only matches as "บางเสาธง".
    const attempts = [query];
    const head = query.split(',')[0]?.trim();
    if (head && head !== query) attempts.push(head);
    for (const q of attempts) {
      const hit = await search(q);
      if (!hit) continue;
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if ((hit.place_rank ?? 0) < MIN_PLACE_RANK) return null; // a whole province
      return { lat, lng, label: (hit.display_name ?? q).slice(0, 200) };
    }
    return null;
  }

  return (query) => {
    const run = queue.then(() => lookup(query));
    queue = run.catch(() => undefined);
    return run;
  };
}
