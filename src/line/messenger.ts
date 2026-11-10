import { messagingApi } from '@line/bot-sdk';
import type { LineProfile } from '../users/repository.js';

export type OutgoingMessage = messagingApi.Message;

/**
 * Thin wrapper over the LINE Messaging API so handlers stay testable.
 * `reply` is free and unlimited; `push` counts against the monthly quota — use sparingly.
 */
export interface LineMessenger {
  reply(replyToken: string, messages: OutgoingMessage[]): Promise<void>;
  push(to: string, messages: OutgoingMessage[]): Promise<void>;
  getProfile(userId: string): Promise<LineProfile>;
}

export function createLineMessenger(channelAccessToken: string): LineMessenger {
  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  return {
    async reply(replyToken, messages) {
      await client.replyMessage({ replyToken, messages });
    },
    async push(to, messages) {
      await client.pushMessage({ to, messages });
    },
    async getProfile(userId) {
      const p = await client.getProfile(userId);
      return { displayName: p.displayName, pictureUrl: p.pictureUrl, language: p.language };
    },
  };
}
