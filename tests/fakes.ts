import { randomUUID } from 'node:crypto';
import type { webhook } from '@line/bot-sdk';
import { vi } from 'vitest';
import type { SessionRepository } from '../src/conversation/repository.js';
import type { User } from '../src/db/schema.js';
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
export function createFakeBot() {
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

  const replies: OutgoingMessage[][] = [];
  const line = {
    reply: vi.fn(async (_token: string, messages: OutgoingMessage[]) => {
      replies.push(messages);
    }),
    push: vi.fn(async () => {}),
    getProfile: vi.fn(async () => ({ displayName: 'Ton', language: 'th' })),
  } satisfies LineMessenger;

  const handle = createEventsHandler({ users, prefs, sessions, line, logger: silentLogger });

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
