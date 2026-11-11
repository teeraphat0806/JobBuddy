import type { Job } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';
import { errorFields } from '../lib/logger.js';
import type { PlaceRepository } from '../places/repository.js';
import { describeDistances, type Point } from './distance.js';
import { describeStation, type RankedPoint } from './stations.js';
import { geoQuery, type Geocoder } from './geocoder.js';
import type { GeocodeRepository } from './repository.js';

/** "Not found" is retried after this long (new OSM data, or a fixed location text). */
const RETRY_MISSES_MS = 30 * 24 * 60 * 60 * 1000;
/** Background lookups waiting at most; the rest are picked up the next time they're shown. */
const MAX_PENDING = 200;

export interface GeoService {
  /** Points for job locations from the cache only; unknown ones are looked up in the background. */
  cached(locations: string[]): Promise<Map<string, RankedPoint | null>>;
  /** One location, looked up now if it isn't cached (a single request). */
  resolve(location: string): Promise<RankedPoint | null>;
  /** Resolves when no background lookups are pending (tests, shutdown). */
  idle(): Promise<void>;
}

export interface GeoServiceDeps {
  geocodes: GeocodeRepository;
  geocoder: Geocoder;
  logger: Logger;
  now?: () => Date;
}

export function createGeoService(deps: GeoServiceDeps): GeoService {
  const now = deps.now ?? (() => new Date());
  const pending = new Set<string>();
  let worker: Promise<void> | null = null;

  const fresh = (resolvedAt: Date, found: boolean) =>
    found || now().getTime() - resolvedAt.getTime() < RETRY_MISSES_MS;

  /** Lookups in progress, so callers asking for the same place at once share one request. */
  const inFlight = new Map<string, Promise<RankedPoint | null>>();

  function lookupAndStore(query: string): Promise<RankedPoint | null> {
    const running = inFlight.get(query);
    if (running) return running;
    const run = (async () => {
      const result = await deps.geocoder(query);
      await deps.geocodes.put(query, result);
      return result ? { lat: result.lat, lng: result.lng, rank: result.rank } : null;
    })().finally(() => inFlight.delete(query));
    inFlight.set(query, run);
    return run;
  }

  function enqueue(queries: string[]) {
    for (const q of queries) if (pending.size < MAX_PENDING) pending.add(q);
    if (worker || pending.size === 0) return;
    worker = (async () => {
      while (pending.size > 0) {
        const q = pending.values().next().value!;
        try {
          await lookupAndStore(q);
        } catch (err) {
          deps.logger.warn('Geocoding failed', { query: q, ...errorFields(err) });
        }
        pending.delete(q);
      }
    })().finally(() => {
      worker = null;
    });
  }

  async function cachedByQuery(queries: string[]) {
    const rows = await deps.geocodes.getMany([...new Set(queries)]);
    const out = new Map<string, RankedPoint | null>();
    const missing: string[] = [];
    for (const q of new Set(queries)) {
      const row = rows.get(q);
      if (row && fresh(row.resolvedAt, row.lat !== null)) {
        const found = row.lat !== null && row.lng !== null;
        out.set(q, found ? { lat: row.lat!, lng: row.lng!, rank: row.placeRank } : null);
        // Found before we kept the rank: still usable, but look it up again for the rank.
        if (found && row.placeRank === null) missing.push(q);
      } else {
        missing.push(q);
      }
    }
    return { out, missing };
  }

  return {
    async cached(locations) {
      const keyOf = new Map<string, string>();
      for (const loc of locations) {
        const q = geoQuery(loc);
        if (q) keyOf.set(loc, q);
      }
      const { out, missing } = await cachedByQuery([...keyOf.values()]);
      enqueue(missing);
      const result = new Map<string, RankedPoint | null>();
      for (const [loc, q] of keyOf) if (out.has(q)) result.set(loc, out.get(q)!);
      return result;
    },

    async resolve(location) {
      const q = geoQuery(location);
      if (!q) return null;
      const { out, missing } = await cachedByQuery([q]);
      if (out.has(q)) {
        enqueue(missing);
        return out.get(q)!;
      }
      try {
        return await lookupAndStore(q);
      } catch (err) {
        deps.logger.warn('Geocoding failed', { query: q, ...errorFields(err) });
        return null;
      }
    },

    async idle() {
      while (worker) await worker;
    },
  };
}

type JobPlace = Pick<Job, 'id' | 'location' | 'workplace'>;

export interface JobDistances {
  /** "บ้าน ~12 กม. · คอนโด ~4.5 กม." per job id, from cached locations only (fast). */
  forJobs(userId: string, jobs: JobPlace[]): Promise<Map<string, string>>;
  /** One job, looking its place up now if needed. null: no places set, remote, or unknown. */
  forJob(userId: string, job: JobPlace): Promise<{ text: string; to: Point } | null>;
  /** "ใกล้ BTS อโศก" / "BTS อโศก ~350 ม." per job id, from cached locations only. */
  stationsFor(jobs: JobPlace[]): Promise<Map<string, string>>;
  /** One job's nearest station, looking its place up now if needed. */
  stationFor(job: JobPlace): Promise<string | null>;
}

/** Distances from the user's saved places (home, condo...) to jobs. Straight-line only. */
export function createJobDistances(deps: {
  places: PlaceRepository;
  geo: GeoService;
}): JobDistances {
  const located = (j: JobPlace) => j.workplace !== 'remote' && j.location.trim() !== '';
  return {
    async forJobs(userId, jobs) {
      const out = new Map<string, string>();
      const targets = jobs.filter(located);
      if (targets.length === 0) return out;
      const places = await deps.places.list(userId);
      if (places.length === 0) return out;
      const points = await deps.geo.cached(targets.map((j) => j.location));
      for (const j of targets) {
        const to = points.get(j.location);
        if (to) out.set(j.id, describeDistances(places, to));
      }
      return out;
    },

    async forJob(userId, job) {
      if (!located(job)) return null;
      const places = await deps.places.list(userId);
      if (places.length === 0) return null;
      const to = await deps.geo.resolve(job.location);
      return to ? { text: describeDistances(places, to), to } : null;
    },

    async stationsFor(jobs) {
      const out = new Map<string, string>();
      const targets = jobs.filter(located);
      if (targets.length === 0) return out;
      const points = await deps.geo.cached(targets.map((j) => j.location));
      for (const j of targets) {
        const text = describeStation(j.location, points.get(j.location) ?? null);
        if (text) out.set(j.id, text);
      }
      return out;
    },

    async stationFor(job) {
      if (!located(job)) return null;
      return describeStation(job.location, await deps.geo.resolve(job.location));
    },
  };
}
