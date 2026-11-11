import { distanceKm, formatKm, type Point } from './distance.js';
import { STATION_ROWS } from './stationData.js';

/** BTS (incl. Gold), MRT (Blue, Purple, Yellow, Pink), Airport Rail Link, SRT Red lines. */
export type RailLine = 'BTS' | 'MRT' | 'ARL' | 'RED';

export interface Station extends Point {
  line: RailLine;
  th: string;
  en: string;
}

export const STATIONS: readonly Station[] = STATION_ROWS.map(([line, th, en, lat, lng]) => ({
  line,
  th,
  en,
  lat,
  lng,
}));

const LINE_NAME: Record<RailLine, string> = {
  BTS: 'BTS',
  MRT: 'MRT',
  ARL: 'Airport Link',
  RED: 'สายสีแดง',
};

/** "BTS อโศก", "Airport Link มักกะสัน". */
export const stationName = (s: Station) => `${LINE_NAME[s.line]} ${s.th}`;

/**
 * How precise a geocoded point is, from Nominatim's place_rank: 26+ is a street, building or
 * landmark; 16-25 a sub-district or neighbourhood; below that a district (too wide to say which
 * station is near). null: looked up before we kept the rank.
 */
export const PRECISE_RANK = 26;
export const AREA_RANK = 16;
/** Walkable-ish from a precise point. */
const NEAR_KM = 1.5;
/** "Around" a neighbourhood's centre. */
const AREA_KM = 2;

export function nearestStation(p: Point, maxKm: number): { station: Station; km: number } | null {
  let best: { station: Station; km: number } | null = null;
  for (const s of STATIONS) {
    const km = distanceKm(p, s);
    if (km <= maxKm && (!best || km < best.km)) best = { station: s, km };
  }
  return best;
}

/** "~350 ม." for short walks, "~1.2 กม." beyond. */
export function formatWalk(km: number): string {
  if (km >= 1) return formatKm(km);
  return `~${Math.max(50, Math.round((km * 1000) / 50) * 50)} ม.`;
}

const RAIL_WORDS =
  /\b(bts|mrt|arl|airport\s*rail(\s*link)?|skytrain|subway|station)\b|บีทีเอส|เอ็มอาร์ที|รถไฟฟ้า|สถานี/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A station the location text itself names, e.g. "ใกล้ BTS อโศก" or "MRT Sam Yan". Only when
 * the text talks about trains at all, so a road or district with a station's name doesn't count.
 */
export function stationInText(location: string): Station | null {
  if (!RAIL_WORDS.test(location)) return null;
  const lower = location.toLowerCase();
  let best: { s: Station; at: number; len: number } | null = null;
  for (const s of STATIONS) {
    const hits: { at: number; len: number }[] = [];
    if ([...s.th].length >= 3) {
      const at = location.indexOf(s.th);
      if (at >= 0) hits.push({ at, len: s.th.length });
    }
    if (s.en.length >= 3 && /^[\x20-\x7e]+$/.test(s.en)) {
      const m = new RegExp(`\\b${escape(s.en.toLowerCase())}\\b`).exec(lower);
      if (m) hits.push({ at: m.index, len: s.en.length });
    }
    for (const h of hits) {
      // Prefer the longest name ("สุขุมวิท 71" over "สุขุมวิท"), then the first mentioned.
      if (!best || h.len > best.len || (h.len === best.len && h.at < best.at)) {
        best = { s, ...h };
      }
    }
  }
  if (!best) return null;
  // The same name on several lines (interchanges): take the line the text mentions, if any.
  const twins = STATIONS.filter((s) => s.th === best.s.th);
  const mentioned = twins.find((s) => new RegExp(`\\b${s.line}\\b`, 'i').test(location));
  return mentioned ?? best.s;
}

export interface RankedPoint extends Point {
  rank: number | null;
}

/**
 * The nearest rail station, worded as precisely as we really know it:
 * named in the posting -> "ใกล้ BTS อโศก"; a street-level point -> "BTS อโศก ~350 ม.";
 * a neighbourhood -> "แถว BTS อโศก". Nothing for a whole district or when no station is close.
 */
export function describeStation(location: string, point: RankedPoint | null): string | null {
  const named = stationInText(location);
  if (named) return `ใกล้ ${stationName(named)}`;
  if (!point || point.rank === null || point.rank < AREA_RANK) return null;
  if (point.rank >= PRECISE_RANK) {
    const near = nearestStation(point, NEAR_KM);
    return near ? `${stationName(near.station)} ${formatWalk(near.km)}` : null;
  }
  const near = nearestStation(point, AREA_KM);
  return near ? `แถว ${stationName(near.station)}` : null;
}
