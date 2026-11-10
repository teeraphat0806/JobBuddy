import type { webhook } from '@line/bot-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createEventsHandler } from '../src/line/handlers.js';
import type { LineMessenger } from '../src/line/messenger.js';
import type { UserRepository } from '../src/users/repository.js';
import { silentLogger } from './helpers.js';

function setup() {
  const users = {
    upsertOnFollow: vi.fn().mockResolvedValue({}),
    markUnfollowed: vi.fn().mockResolvedValue(undefined),
    findByLineUserId: vi.fn(),
  } satisfies UserRepository;
  const line = {
    reply: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    getProfile: vi.fn().mockResolvedValue({ displayName: 'Ton', language: 'th' }),
  } satisfies LineMessenger;
  const handle = createEventsHandler({ users, line, logger: silentLogger });
  return { users, line, handle };
}

const base = {
  timestamp: 0,
  mode: 'active',
  webhookEventId: 'evt',
  deliveryContext: { isRedelivery: false },
  source: { type: 'user', userId: 'U123' },
} as const;

const followEvent = {
  ...base,
  type: 'follow',
  replyToken: 'rt-follow',
  follow: { isUnblocked: false },
} as webhook.Event;

describe('createEventsHandler', () => {
  it('saves the user and replies with a welcome on follow', async () => {
    const { users, line, handle } = setup();
    await handle([followEvent]);

    expect(users.upsertOnFollow).toHaveBeenCalledWith('U123', {
      displayName: 'Ton',
      language: 'th',
    });
    expect(line.reply).toHaveBeenCalledOnce();
    const [token, messages] = line.reply.mock.calls[0]!;
    expect(token).toBe('rt-follow');
    expect(JSON.stringify(messages)).toContain('คุณTon');
  });

  it('still saves the user when the profile lookup fails', async () => {
    const { users, line, handle } = setup();
    line.getProfile.mockRejectedValueOnce(new Error('403'));
    await handle([followEvent]);
    expect(users.upsertOnFollow).toHaveBeenCalledWith('U123', {});
    expect(line.reply).toHaveBeenCalledOnce();
  });

  it('marks the user unfollowed on unfollow', async () => {
    const { users, line, handle } = setup();
    await handle([{ ...base, type: 'unfollow' } as webhook.Event]);
    expect(users.markUnfollowed).toHaveBeenCalledWith('U123');
    expect(line.reply).not.toHaveBeenCalled();
  });

  it('replies (never pushes) to a text message', async () => {
    const { line, handle } = setup();
    await handle([
      {
        ...base,
        type: 'message',
        replyToken: 'rt-msg',
        message: { type: 'text', id: 'm1', quoteToken: 'q', text: 'hi' },
      } as webhook.Event,
    ]);
    expect(line.reply).toHaveBeenCalledWith('rt-msg', expect.any(Array));
    expect(line.push).not.toHaveBeenCalled();
  });

  it('keeps processing other events when one fails', async () => {
    const { users, handle } = setup();
    users.upsertOnFollow.mockRejectedValueOnce(new Error('db down'));
    await expect(
      handle([followEvent, { ...base, type: 'unfollow' } as webhook.Event]),
    ).resolves.toBeUndefined();
    expect(users.markUnfollowed).toHaveBeenCalledWith('U123');
  });
});
