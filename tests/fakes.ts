import { randomUUID } from 'node:crypto';
import type { webhook } from '@line/bot-sdk';
import { vi } from 'vitest';
import type { SessionRepository } from '../src/conversation/repository.js';
import type { Interview, Job, User } from '../src/db/schema.js';
import type { InterviewRepository } from '../src/interviews/repository.js';
import {
  LINK_PROVIDER,
  type ApplicationStage,
  type JobRepository,
  type UserJobRepository,
  type UserJobStatus,
} from '../src/jobs/repository.js';
import type { LinkPreview } from '../src/links/preview.js';
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
    { status: UserJobStatus; stage: ApplicationStage | null; at: number }
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
      return r ? { status: r.status, stage: r.stage } : undefined;
    },
    async setStatus(userId, jobId, status) {
      const prev = userJobRows.get(ujKey(userId, jobId));
      const stage = status === 'applied' ? (prev?.stage ?? 'applied') : null;
      userJobRows.set(ujKey(userId, jobId), { status, stage, at: ++tick });
    },
    setStage: async (userId, jobId, stage) =>
      void userJobRows.set(ujKey(userId, jobId), { status: 'applied', stage, at: ++tick }),
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

  const replies: OutgoingMessage[][] = [];
  const line = {
    reply: vi.fn(async (_token: string, messages: OutgoingMessage[]) => {
      replies.push(messages);
    }),
    push: vi.fn(async () => {}),
    getProfile: vi.fn(async () => ({ displayName: 'Ton', language: 'th' })),
    getBotBasicId: vi.fn(async () => '@jobbuddy'),
  } satisfies LineMessenger;

  const handle = createEventsHandler({
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
