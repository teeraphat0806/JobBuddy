import { randomUUID } from 'node:crypto';
import type { webhook } from '@line/bot-sdk';
import { vi } from 'vitest';
import type { SessionRepository } from '../src/conversation/repository.js';
import type { Geocode, Interview, Job, User, UserPlace } from '../src/db/schema.js';
import type { Point } from '../src/geo/distance.js';
import type { GeocodeRepository } from '../src/geo/repository.js';
import { createGeoService, createJobDistances } from '../src/geo/service.js';
import type { PlaceRepository } from '../src/places/repository.js';
import type { InterviewRepository } from '../src/interviews/repository.js';
import {
  LINK_PROVIDER,
  type ApplicationStage,
  type JobRepository,
  type UserJobRepository,
  type UserJobStatus,
} from '../src/jobs/repository.js';
import type {
  ImportOutcome,
  ImportSummary,
  LinkImportRepository,
} from '../src/links/importRepository.js';
import { createLinkImportWorker } from '../src/links/importWorker.js';
import type { LinkPreview } from '../src/links/preview.js';
import { createLinkSaver } from '../src/links/saveLink.js';
import type { NoteRepository } from '../src/notes/repository.js';
import { createEventsHandler } from '../src/line/handlers.js';
import type { LineMessenger, OutgoingMessage } from '../src/line/messenger.js';
import { encodePostback, type PostbackData } from '../src/line/postback.js';
import type { PrefsRepository } from '../src/prefs/repository.js';
import type { PrefsInput } from '../src/prefs/types.js';
import type { UserRepository } from '../src/users/repository.js';
import { silentLogger } from './helpers.js';

function newUser(lineUserId: string): User {
  const now = new Date();
  return {
    id: randomUUID(),
    lineUserId,
    displayName: null,
    pictureUrl: null,
    language: null,
    status: 'active',
    notifyInterviewReminders: true,
    pdpaConsentedAt: null,
    followedAt: null,
    unfollowedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** In-memory stand-ins for the DB repositories, so whole conversations can be tested. */
export function createFakeBot(opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  const usersByLineId = new Map<string, User>();
  const prefsByUser = new Map<string, PrefsInput>();
  const sessionsByUser = new Map<string, { flow: string; state: unknown }>();

  const users: UserRepository = {
    async upsertOnFollow(lineUserId, profile) {
      const u = usersByLineId.get(lineUserId) ?? newUser(lineUserId);
      if (profile.displayName !== undefined) u.displayName = profile.displayName;
      u.status = 'active';
      u.followedAt = new Date();
      u.unfollowedAt = null;
      usersByLineId.set(lineUserId, u);
      return { ...u };
    },
    async markUnfollowed(lineUserId) {
      const u = usersByLineId.get(lineUserId);
      if (u) u.status = 'unfollowed';
    },
    async findByLineUserId(lineUserId) {
      return usersByLineId.get(lineUserId);
    },
    async ensure(lineUserId) {
      if (!usersByLineId.has(lineUserId)) usersByLineId.set(lineUserId, newUser(lineUserId));
      return { ...usersByLineId.get(lineUserId)! };
    },
    async recordConsent(userId) {
      for (const u of usersByLineId.values()) if (u.id === userId) u.pdpaConsentedAt = new Date();
    },
    async setReminders(userId, on) {
      for (const u of usersByLineId.values()) if (u.id === userId) u.notifyInterviewReminders = on;
    },
    async deleteByLineUserId(lineUserId) {
      const u = usersByLineId.get(lineUserId);
      if (!u) return;
      prefsByUser.delete(u.id);
      sessionsByUser.delete(u.id);
      usersByLineId.delete(lineUserId);
    },
  };

  const prefs: PrefsRepository = {
    get: async (userId) => prefsByUser.get(userId),
    save: async (userId, p) => void prefsByUser.set(userId, p),
  };

  const sessions: SessionRepository = {
    get: async (userId) => sessionsByUser.get(userId),
    set: async (userId, flow, state) => void sessionsByUser.set(userId, { flow, state }),
    clear: async (userId) => void sessionsByUser.delete(userId),
  };

  const jobRows = new Map<string, Job>();
  const userJobRows = new Map<
    string,
    { status: UserJobStatus; stage: ApplicationStage | null; since: Date | null; at: number }
  >();
  const noteRows: { userId: string; jobId: string; body: string; at: number }[] = [];
  const ujKey = (userId: string, jobId: string) => `${userId}:${jobId}`;
  let tick = 0;

  const jobs: JobRepository = {
    async upsertListings() {},
    async deactivateMissing() {
      return 0;
    },
    listActive: async () =>
      [...jobRows.values()].filter((j) => j.active && j.provider !== LINK_PROVIDER),
    getById: async (id) => jobRows.get(id),
    findByUrl: async (url) => [...jobRows.values()].find((j) => j.url === url),
    findBySource: async (provider, board, externalId) =>
      [...jobRows.values()].find(
        (j) => j.provider === provider && j.board === board && j.externalId === externalId,
      ),
    async createLinkJob(input) {
      const existing = await jobs.findBySource(LINK_PROVIDER, input.board, input.externalId);
      if (existing) return existing;
      const id = addJob({ ...input, provider: LINK_PROVIDER, postedAt: null });
      return jobRows.get(id)!;
    },
    async rename(id, title, company) {
      const j = jobRows.get(id);
      if (j) Object.assign(j, company ? { title, company } : { title });
    },
    listLinkJobs: async () => [...jobRows.values()].filter((j) => j.provider === LINK_PROVIDER),
    lastSyncedAt: async () => null,
  };

  const userJobs: UserJobRepository = {
    async statuses(userId) {
      const out = new Map<string, UserJobStatus>();
      for (const [k, v] of userJobRows)
        if (k.startsWith(`${userId}:`)) out.set(k.split(':')[1]!, v.status);
      return out;
    },
    async get(userId, jobId) {
      const r = userJobRows.get(ujKey(userId, jobId));
      return r ? { status: r.status, stage: r.stage, stageSince: r.since } : undefined;
    },
    async setStatus(userId, jobId, status) {
      const prev = userJobRows.get(ujKey(userId, jobId));
      const applied = status === 'applied';
      const stage = applied ? (prev?.stage ?? 'applied') : null;
      const since = applied ? (prev?.stage ? prev.since : now()) : null;
      userJobRows.set(ujKey(userId, jobId), { status, stage, since, at: ++tick });
    },
    async setStage(userId, jobId, stage) {
      const prev = userJobRows.get(ujKey(userId, jobId));
      const since = prev?.stage === stage ? (prev.since ?? now()) : now();
      userJobRows.set(ujKey(userId, jobId), { status: 'applied', stage, since, at: ++tick });
    },
    clear: async (userId, jobId) => void userJobRows.delete(ujKey(userId, jobId)),
    async list(userId, status, limit, offset = 0) {
      return [...userJobRows.entries()]
        .filter(([k, v]) => k.startsWith(`${userId}:`) && v.status === status)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(offset, offset + limit)
        .map(([k, v]) => {
          const jobId = k.split(':')[1]!;
          return {
            job: jobRows.get(jobId)!,
            stage: v.stage,
            stageSince: v.since,
            noteCount: noteRows.filter((n) => n.userId === userId && n.jobId === jobId).length,
          };
        });
    },
    async otherTrackers(userId, jobId) {
      return [...userJobRows.keys()].filter(
        (k) => k.endsWith(`:${jobId}`) && !k.startsWith(`${userId}:`),
      ).length;
    },
    async count(userId, status) {
      return [...userJobRows.entries()].filter(
        ([k, v]) => k.startsWith(`${userId}:`) && v.status === status,
      ).length;
    },
  };

  /** Add a job to the fake catalogue; returns its id. */
  function addJob(partial: Partial<Job> & { title: string }): string {
    const now = new Date();
    const job: Job = {
      id: randomUUID(),
      provider: 'greenhouse',
      board: 'acme',
      externalId: randomUUID(),
      company: 'Acme',
      location: 'Bangkok, Thailand',
      department: null,
      workplace: null,
      url: 'https://example.com/jobs/1',
      postedAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
      active: true,
      ...partial,
    };
    jobRows.set(job.id, job);
    return job.id;
  }

  const notes: NoteRepository = {
    add: async (userId, jobId, body) => void noteRows.push({ userId, jobId, body, at: ++tick }),
    list: async (userId, jobId, limit) =>
      noteRows
        .filter((n) => n.userId === userId && n.jobId === jobId)
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map((n, i) => ({ id: `n${i}`, ...n, createdAt: new Date(n.at * 60_000) })),
    count: async (userId, jobId) =>
      noteRows.filter((n) => n.userId === userId && n.jobId === jobId).length,
  };

  const interviewRows = new Map<string, Interview>();
  const withJob = (iv: Interview) => ({ interview: { ...iv }, job: jobRows.get(iv.jobId)! });
  const interviews: InterviewRepository = {
    async create(userId, jobId, startsAt) {
      const iv: Interview = {
        id: randomUUID(),
        userId,
        jobId,
        startsAt,
        place: null,
        scheduledAt: now(),
        remindedEveningAt: null,
        remindedSoonAt: null,
        createdAt: now(),
      };
      interviewRows.set(iv.id, iv);
      return { ...iv };
    },
    async get(userId, id) {
      const iv = interviewRows.get(id);
      return iv && iv.userId === userId ? withJob(iv) : undefined;
    },
    async reschedule(userId, id, startsAt) {
      const iv = interviewRows.get(id);
      if (!iv || iv.userId !== userId) return false;
      Object.assign(iv, {
        startsAt,
        scheduledAt: now(),
        remindedEveningAt: null,
        remindedSoonAt: null,
      });
      return true;
    },
    async setPlace(userId, id, place) {
      const iv = interviewRows.get(id);
      if (!iv || iv.userId !== userId) return false;
      iv.place = place;
      return true;
    },
    async remove(userId, id) {
      const iv = interviewRows.get(id);
      if (!iv || iv.userId !== userId) return false;
      return interviewRows.delete(id);
    },
    async upcoming(userId, from, limit) {
      return [...interviewRows.values()]
        .filter((iv) => iv.userId === userId && iv.startsAt > from)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .slice(0, limit)
        .map(withJob);
    },
    async upcomingForJob(userId, jobId, from) {
      return [...interviewRows.values()].filter(
        (iv) => iv.userId === userId && iv.jobId === jobId && iv.startsAt > from,
      );
    },
    async reminderCandidates() {
      return [];
    },
    async claimReminder() {
      return true;
    },
  };

  /** What the fake link previewer returns; tests overwrite it. */
  const linkPreview: { next: Omit<LinkPreview, 'url'> } = {
    next: { title: null, company: null, location: '', department: null, workplace: null },
  };
  const previewLink = vi.fn(async (url: string): Promise<LinkPreview> => ({
    url,
    ...linkPreview.next,
  }));

  // ---- Places and geocoding: `geoPoints` maps a geocoder query to where it is.
  const placeRows: UserPlace[] = [];
  const places: PlaceRepository = {
    list: async (userId) => placeRows.filter((p) => p.userId === userId),
    async add(userId, label, lat, lng) {
      const row: UserPlace = { id: randomUUID(), userId, label, lat, lng, createdAt: now() };
      placeRows.push(row);
      return row;
    },
    async rename(userId, id, label) {
      const row = placeRows.find((p) => p.id === id && p.userId === userId);
      if (row) row.label = label;
      return Boolean(row);
    },
    async remove(userId, id) {
      const i = placeRows.findIndex((p) => p.id === id && p.userId === userId);
      if (i >= 0) placeRows.splice(i, 1);
      return i >= 0;
    },
  };
  const geocodeRows = new Map<string, Geocode>();
  const geocodeRepo: GeocodeRepository = {
    getMany: async (qs) =>
      new Map(qs.filter((q) => geocodeRows.has(q)).map((q) => [q, geocodeRows.get(q)!])),
    async put(query, r) {
      geocodeRows.set(query, {
        query,
        lat: r?.lat ?? null,
        lng: r?.lng ?? null,
        label: r?.label ?? null,
        resolvedAt: now(),
      });
    },
  };
  const geoPoints = new Map<string, Point>();
  const geocoder = vi.fn(async (q: string) => {
    const p = geoPoints.get(q);
    return p ? { ...p, label: q } : null;
  });
  const geo = createGeoService({ geocodes: geocodeRepo, geocoder, logger: silentLogger, now });
  const distances = createJobDistances({ places, geo });

  // ---- Link import queue (in memory), drained by the real worker.
  const importBatches = new Map<string, { userId: string; total: number; repeated: number }>();
  const importRows: {
    id: string;
    batchId: string;
    userId: string;
    url: string;
    status: 'pending' | 'working' | 'done';
    outcome: ImportOutcome | null;
    jobId: string | null;
  }[] = [];
  const linkImportRepo: LinkImportRepository = {
    async enqueue(userId, urls, total, repeated) {
      const batchId = randomUUID();
      importBatches.set(batchId, { userId, total, repeated });
      for (const url of urls) {
        importRows.push({
          id: randomUUID(),
          batchId,
          userId,
          url,
          status: 'pending',
          outcome: null,
          jobId: null,
        });
      }
      return batchId;
    },
    queuedCount: async (userId) =>
      importRows.filter((r) => r.userId === userId && r.status !== 'done').length,
    async claim(limit) {
      const taken = importRows.filter((r) => r.status === 'pending').slice(0, limit);
      for (const r of taken) r.status = 'working';
      return taken.map(({ id, batchId, userId, url }) => ({ id, batchId, userId, url }));
    },
    async finish(id, outcome, jobId) {
      const r = importRows.find((x) => x.id === id)!;
      Object.assign(r, { status: 'done', outcome, jobId });
    },
    async takeFinished(shown) {
      const out: ImportSummary[] = [];
      const usersDone = new Set(
        [...importBatches.values()]
          .map((b) => b.userId)
          .filter((u) => !importRows.some((r) => r.userId === u && r.status !== 'done')),
      );
      for (const userId of usersDone) {
        const ids = [...importBatches].filter(([, b]) => b.userId === userId).map(([id]) => id);
        const rows = importRows.filter((r) => ids.includes(r.batchId));
        const counts = { new: 0, duplicate: 0, invalid: 0, failed: 0 };
        for (const r of rows) if (r.outcome) counts[r.outcome]++;
        const user = [...usersByLineId.values()].find((u) => u.id === userId)!;
        out.push({
          userId,
          lineUserId: user.lineUserId,
          total: ids.reduce((n, id) => n + importBatches.get(id)!.total, 0),
          repeated: ids.reduce((n, id) => n + importBatches.get(id)!.repeated, 0),
          counts,
          newJobs: rows
            .filter((r) => r.outcome === 'new')
            .slice(0, shown)
            .map((r) => ({
              title: jobRows.get(r.jobId!)!.title,
              company: jobRows.get(r.jobId!)!.company,
            })),
        });
        for (const id of ids) importBatches.delete(id);
        for (let i = importRows.length - 1; i >= 0; i--) {
          if (ids.includes(importRows[i]!.batchId)) importRows.splice(i, 1);
        }
      }
      return out;
    },
  };
  const kickImports = vi.fn();

  const replies: OutgoingMessage[][] = [];
  const line = {
    reply: vi.fn(async (_token: string, messages: OutgoingMessage[]) => {
      replies.push(messages);
    }),
    push: vi.fn(async () => {}),
    getProfile: vi.fn(async () => ({ displayName: 'Ton', language: 'th' })),
    getBotBasicId: vi.fn(async () => '@jobbuddy'),
  } satisfies LineMessenger;

  const importWorker = createLinkImportWorker({
    imports: linkImportRepo,
    saveLink: createLinkSaver({ jobs, userJobs, previewLink }),
    line,
    logger: silentLogger,
    perSiteIntervalMs: 0,
  });

  const handle = createEventsHandler({
    linkImports: { repo: linkImportRepo, kick: kickImports },
    places,
    distances,
    warmDistances: () => {},
    users,
    prefs,
    sessions,
    jobs,
    userJobs,
    notes,
    interviews,
    previewLink,
    line,
    logger: silentLogger,
    now,
    getAddFriendUrl: () => 'https://line.me/R/ti/p/%40jobbuddy',
  });

  const base = (userId: string) => ({
    timestamp: 0,
    mode: 'active' as const,
    webhookEventId: randomUUID(),
    deliveryContext: { isRedelivery: false },
    source: { type: 'user' as const, userId },
  });

  /** Sends one event and returns the texts of the reply (empty if no reply). */
  async function send(event: webhook.Event): Promise<string[]> {
    const before = replies.length;
    await handle([event]);
    const reply = replies.length > before ? replies[replies.length - 1]! : [];
    return reply.map((m) => (m.type === 'text' ? m.text : `[${m.type}]`));
  }

  const lastReply = () => replies[replies.length - 1] ?? [];

  return {
    users,
    usersByLineId,
    prefsByUser,
    sessionsByUser,
    jobRows,
    userJobRows,
    noteRows,
    interviewRows,
    linkPreview,
    previewLink,
    addJob,
    jobs,
    placeRows,
    importRows,
    kickImports,
    /** Runs the background link queue until it's empty. */
    drainImports: () => importWorker.drain(),
    geocodeRows,
    geoPoints,
    geocoder,
    geo,
    line,
    handle,
    lastReply,
    follow: (userId = 'U1') =>
      send({
        ...base(userId),
        type: 'follow',
        replyToken: 'rt',
        follow: { isUnblocked: false },
      } as webhook.Event),
    unfollow: (userId = 'U1') => send({ ...base(userId), type: 'unfollow' } as webhook.Event),
    say: (textBody: string, userId = 'U1') =>
      send({
        ...base(userId),
        type: 'message',
        replyToken: 'rt',
        message: { type: 'text', id: 'm', quoteToken: 'q', text: textBody },
      } as webhook.Event),
    tap: (data: PostbackData, userId = 'U1') =>
      send({
        ...base(userId),
        type: 'postback',
        replyToken: 'rt',
        postback: { data: encodePostback(data) },
      } as webhook.Event),
    /** A date/time picker choice, e.g. "2026-11-15T14:00". */
    /** The user shares a location from LINE's map. */
    shareLocation: (lat: number, lng: number, userId = 'U1') =>
      send({
        ...base(userId),
        type: 'message',
        replyToken: 'rt',
        message: { type: 'location', id: 'm', latitude: lat, longitude: lng, address: 'x' },
      } as webhook.Event),
    pick: (data: PostbackData, datetime: string, userId = 'U1') =>
      send({
        ...base(userId),
        type: 'postback',
        replyToken: 'rt',
        postback: { data: encodePostback(data), params: { datetime } },
      } as webhook.Event),
    sticker: (userId = 'U1') =>
      send({
        ...base(userId),
        type: 'message',
        replyToken: 'rt',
        message: {
          type: 'sticker',
          id: 's',
          packageId: '1',
          stickerId: '1',
          stickerResourceType: 'STATIC',
        },
      } as webhook.Event),
  };
}
