import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversationSessions } from '../db/schema.js';

export interface ConversationSession {
  flow: string;
  state: unknown;
}

export interface SessionRepository {
  /** Returns the active (non-expired) session, if any. */
  get(userId: string): Promise<ConversationSession | undefined>;
  set(userId: string, flow: string, state: unknown, ttlMs?: number): Promise<void>;
  clear(userId: string): Promise<void>;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export function createSessionRepository(
  db: Db,
  now: () => Date = () => new Date(),
): SessionRepository {
  return {
    async get(userId) {
      const row = await db.query.conversationSessions.findFirst({
        where: and(
          eq(conversationSessions.userId, userId),
          gt(conversationSessions.expiresAt, now()),
        ),
      });
      return row ? { flow: row.flow, state: row.state } : undefined;
    },

    async set(userId, flow, state, ttlMs = DEFAULT_TTL_MS) {
      const expiresAt = new Date(now().getTime() + ttlMs);
      await db
        .insert(conversationSessions)
        .values({ userId, flow, state, expiresAt })
        .onConflictDoUpdate({
          target: conversationSessions.userId,
          set: { flow, state, expiresAt, updatedAt: now() },
        });
    },

    async clear(userId) {
      await db.delete(conversationSessions).where(eq(conversationSessions.userId, userId));
    },
  };
}
