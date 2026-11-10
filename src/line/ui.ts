import type { messagingApi } from '@line/bot-sdk';
import type { OutgoingMessage } from './messenger.js';
import { encodePostback, type PostbackData } from './postback.js';

/** Quick reply button that sends `text` as if the user typed it. */
export function sayButton(label: string, text = label): messagingApi.QuickReplyItem {
  return { type: 'action', action: { type: 'message', label: clip(label), text } };
}

/** Quick reply button that sends a postback; `displayText` shows in chat as the user's bubble. */
export function postbackButton(
  label: string,
  data: PostbackData,
  displayText = label,
): messagingApi.QuickReplyItem {
  return {
    type: 'action',
    action: { type: 'postback', label: clip(label), data: encodePostback(data), displayText },
  };
}

export function text(body: string, quickReplies?: messagingApi.QuickReplyItem[]): OutgoingMessage {
  const msg: messagingApi.TextMessage = { type: 'text', text: body };
  if (quickReplies && quickReplies.length > 0) {
    msg.quickReply = { items: quickReplies.slice(0, 13) };
  }
  return msg;
}

/** LINE action labels are limited to 20 characters. */
function clip(label: string): string {
  const chars = [...label];
  return chars.length <= 20 ? label : chars.slice(0, 19).join('') + '…';
}
