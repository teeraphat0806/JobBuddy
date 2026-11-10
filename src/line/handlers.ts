import type { webhook } from '@line/bot-sdk';
import { errorFields, type Logger } from '../lib/logger.js';
import type { LineProfile, UserRepository } from '../users/repository.js';
import { helpMessage, welcomeMessages } from './messages.js';
import type { LineMessenger } from './messenger.js';

export interface HandlerDeps {
  users: UserRepository;
  line: LineMessenger;
  logger: Logger;
}

export type EventsHandler = (events: webhook.Event[]) => Promise<void>;

function userIdOf(event: webhook.Event): string | undefined {
  return event.source?.type === 'user' ? event.source.userId : undefined;
}

export function createEventsHandler(deps: HandlerDeps): EventsHandler {
  const { users, line, logger } = deps;

  async function handle(event: webhook.Event): Promise<void> {
    const userId = userIdOf(event);

    switch (event.type) {
      case 'follow': {
        if (!userId) return;
        let profile: LineProfile = {};
        try {
          profile = await line.getProfile(userId);
        } catch (err) {
          logger.warn('getProfile failed; continuing without profile', errorFields(err));
        }
        await users.upsertOnFollow(userId, profile);
        await line.reply(event.replyToken, welcomeMessages(profile.displayName));
        return;
      }

      case 'unfollow': {
        if (userId) await users.markUnfollowed(userId);
        return;
      }

      case 'message': {
        if (event.replyToken) await line.reply(event.replyToken, [helpMessage()]);
        return;
      }

      default:
        logger.debug('Ignoring unsupported event', { type: event.type });
    }
  }

  return async (events) => {
    // Handle each event independently so one failure doesn't drop the rest.
    const results = await Promise.allSettled(events.map(handle));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.error('Event handling failed', {
          eventType: events[i]?.type,
          webhookEventId: events[i]?.webhookEventId,
          ...errorFields(r.reason),
        });
      }
    });
  };
}
