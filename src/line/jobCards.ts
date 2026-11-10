import type { messagingApi } from '@line/bot-sdk';
import type { Workplace } from '../jobs/types.js';
import type { OutgoingMessage } from './messenger.js';
import { encodePostback } from './postback.js';

export interface CardJob {
  id: string;
  title: string;
  company: string;
  location: string;
  department: string | null;
  workplace: Workplace | null;
  url: string;
  active: boolean;
}

export type CardVariant = 'feed' | 'saved' | 'applied';

const WORKPLACE_LABEL: Record<Workplace, string> = {
  onsite: 'เข้าออฟฟิศ',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

const LINE_URI_MAX = 1000;

const truncate = (s: string, max: number) => {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…';
};

/**
 * LINE's share URL scheme opens the friend/group picker with the text pre-filled.
 * The user sends it themselves, so it costs us no message quota.
 */
export function shareUrl(job: CardJob, addFriendUrl?: string): string {
  const build = (title: string, withFooter: boolean) => {
    const lines = [`💼 ${title}`, `🏢 ${job.company}`, `📍 ${job.location}`, `🔗 ${job.url}`];
    if (withFooter && addFriendUrl) lines.push('', `หางานง่ายๆ ใน LINE 👉 ${addFriendUrl}`);
    return `https://line.me/R/share?text=${encodeURIComponent(lines.join('\n'))}`;
  };
  for (const [title, footer] of [
    [job.title, true],
    [job.title, false],
    [truncate(job.title, 40), false],
  ] as const) {
    const url = build(title, footer);
    if (url.length <= LINE_URI_MAX) return url;
  }
  // Last resort: just the link to the posting.
  return `https://line.me/R/share?text=${encodeURIComponent(job.url)}`.slice(0, LINE_URI_MAX);
}

function jobAction(
  label: string,
  v: string,
  job: CardJob,
  style: 'primary' | 'secondary' | 'link' = 'secondary',
): messagingApi.FlexButton {
  return {
    type: 'button',
    style,
    height: 'sm',
    action: {
      type: 'postback',
      label,
      data: encodePostback({ a: 'job', v, j: job.id }),
      displayText: `${label}: ${truncate(job.title, 40)}`,
    },
  };
}

function row(...contents: messagingApi.FlexComponent[]): messagingApi.FlexBox {
  return { type: 'box', layout: 'horizontal', spacing: 'sm', contents };
}

function infoLine(icon: string, value: string): messagingApi.FlexText {
  return {
    type: 'text',
    text: `${icon} ${value}`,
    size: 'sm',
    color: '#555555',
    wrap: true,
    maxLines: 2,
  };
}

export function jobBubble(
  job: CardJob,
  variant: CardVariant,
  opts: { isNew?: boolean; addFriendUrl?: string } = {},
): messagingApi.FlexBubble {
  const tags: string[] = [];
  if (opts.isNew) tags.push('🆕 ใหม่');
  if (job.workplace) tags.push(WORKPLACE_LABEL[job.workplace]);
  if (!job.active) tags.push('⛔ ปิดรับสมัครแล้ว');

  const body: messagingApi.FlexComponent[] = [
    {
      type: 'text',
      text: job.company,
      size: 'sm',
      color: '#06C755',
      weight: 'bold',
      wrap: true,
      maxLines: 1,
    },
    { type: 'text', text: job.title, size: 'lg', weight: 'bold', wrap: true, maxLines: 3 },
    infoLine('📍', job.location),
  ];
  if (job.department) body.push(infoLine('🏷️', job.department));
  if (tags.length)
    body.push({ type: 'text', text: tags.join(' · '), size: 'xs', color: '#999999', wrap: true });

  const details: messagingApi.FlexButton = {
    type: 'button',
    style: 'primary',
    color: '#06C755',
    height: 'sm',
    action: { type: 'uri', label: 'ดูรายละเอียด / สมัคร', uri: job.url },
  };
  const share: messagingApi.FlexButton = {
    type: 'button',
    style: 'secondary',
    height: 'sm',
    action: { type: 'uri', label: '📤 แชร์', uri: shareUrl(job, opts.addFriendUrl) },
  };

  const footer: messagingApi.FlexComponent[] = [details];
  switch (variant) {
    case 'feed':
      footer.push(
        row(jobAction('⭐ เก็บไว้', 'save', job), jobAction('✅ สมัครแล้ว', 'apply', job)),
      );
      footer.push(row(share, jobAction('❌ ไม่สนใจ', 'hide', job)));
      break;
    case 'saved':
      footer.push(
        row(jobAction('✅ สมัครแล้ว', 'apply', job), jobAction('🗑️ เอาออก', 'unsave', job)),
      );
      footer.push(share);
      break;
    case 'applied':
      footer.push(share);
      break;
  }

  return {
    type: 'bubble',
    size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer },
  };
}

function moreBubble(nextPage: number): messagingApi.FlexBubble {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      justifyContent: 'center',
      contents: [
        { type: 'text', text: 'ยังมีงานอีก 👀', weight: 'bold', size: 'lg', align: 'center' },
        {
          type: 'button',
          style: 'primary',
          color: '#06C755',
          margin: 'lg',
          action: {
            type: 'postback',
            label: 'ดูเพิ่ม',
            data: encodePostback({ a: 'feed', p: String(nextPage) }),
            displayText: 'ดูงานเพิ่ม',
          },
        },
      ],
    },
  };
}

export function jobCarousel(
  items: { job: CardJob; isNew?: boolean }[],
  variant: CardVariant,
  opts: { altText: string; nextPage?: number; addFriendUrl?: string },
): OutgoingMessage {
  // A carousel holds at most 12 bubbles.
  const bubbles = items
    .slice(0, opts.nextPage ? 11 : 12)
    .map(({ job, isNew }) => jobBubble(job, variant, { isNew, addFriendUrl: opts.addFriendUrl }));
  if (opts.nextPage) bubbles.push(moreBubble(opts.nextPage));
  return {
    type: 'flex',
    altText: opts.altText,
    contents: { type: 'carousel', contents: bubbles },
  };
}
