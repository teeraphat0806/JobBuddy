import type { messagingApi } from '@line/bot-sdk';
import type { ListedJob } from '../jobs/repository.js';
import type { OutgoingMessage } from './messenger.js';
import { encodePostback, type PostbackData } from './postback.js';
import { STAGE_LABEL } from './stages.js';

export type ListStatus = 'saved' | 'applied';
export type ListView = 'list' | 'card';

export const LIST_PAGE_SIZE = 15;
export const CARD_PAGE_SIZE = 10;

export const LIST_TITLE: Record<ListStatus, string> = {
  saved: '⭐ งานที่เก็บไว้',
  applied: '📋 งานที่สมัครไว้',
};

/** Postback that opens a page of a list in a view. */
export const listData = (status: ListStatus, view: ListView, page: number): PostbackData => ({
  a: 'list',
  s: status,
  v: view,
  p: String(page),
});

const truncate = (s: string, max: number) => {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…';
};

function navButton(label: string, data: PostbackData): messagingApi.FlexButton {
  return {
    type: 'button',
    style: 'link',
    height: 'sm',
    action: { type: 'postback', label, data: encodePostback(data), displayText: label },
  };
}

/** A list row, with the stage's day count and distances already worked out. */
export type ListRow = ListedJob & { stageText?: string; distanceText?: string };

function row(item: ListRow, n: number): messagingApi.FlexBox {
  const { job, stage, noteCount } = item;
  const meta = [job.company];
  if (stage) meta.push(item.stageText ?? STAGE_LABEL[stage]);
  // Nearest place only: rows are short.
  if (item.distanceText) meta.push(`📏 ${item.distanceText.split(' · ')[0]}`);
  if (noteCount) meta.push(`📝 ${noteCount}`);
  if (!job.active) meta.push('⛔ ปิดรับ');
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    paddingTop: 'md',
    paddingBottom: 'md',
    action: {
      type: 'postback',
      label: 'ดู',
      data: encodePostback({ a: 'job', v: 'detail', j: job.id }),
      displayText: `📄 ${truncate(job.title, 40)}`,
    },
    contents: [
      { type: 'text', text: `${n}.`, size: 'sm', color: '#999999', flex: 0 },
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        contents: [
          { type: 'text', text: job.title, size: 'sm', weight: 'bold', wrap: true, maxLines: 2 },
          {
            type: 'text',
            text: meta.join(' · '),
            size: 'xs',
            color: '#777777',
            wrap: true,
            maxLines: 2,
          },
        ],
      },
      { type: 'text', text: '›', size: 'lg', color: '#BBBBBB', flex: 0, gravity: 'center' },
    ],
  };
}

/**
 * One bubble listing many jobs compactly: tap a row for its details and notes.
 * Much easier to scan than a carousel once a user has more than a handful of jobs.
 */
export function jobListMessage(
  items: ListRow[],
  status: ListStatus,
  opts: { total: number; page: number },
): OutgoingMessage {
  const pages = Math.max(1, Math.ceil(opts.total / LIST_PAGE_SIZE));
  const first = (opts.page - 1) * LIST_PAGE_SIZE;

  const rows: messagingApi.FlexComponent[] = [];
  items.forEach((item, i) => {
    if (i > 0) rows.push({ type: 'separator' });
    rows.push(row(item, first + i + 1));
  });

  const nav: messagingApi.FlexComponent[] = [];
  if (opts.page > 1) nav.push(navButton('◀ ก่อนหน้า', listData(status, 'list', opts.page - 1)));
  nav.push(
    navButton('🃏 แบบการ์ด', listData(status, 'card', Math.floor(first / CARD_PAGE_SIZE) + 1)),
  );
  if (opts.page < pages) nav.push(navButton('ถัดไป ▶', listData(status, 'list', opts.page + 1)));

  return {
    type: 'flex',
    altText: `${LIST_TITLE[status]} ${opts.total} งาน`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingBottom: 'sm',
        contents: [
          { type: 'text', text: `${LIST_TITLE[status]} · ${opts.total} งาน`, weight: 'bold' },
          {
            type: 'text',
            text:
              pages > 1
                ? `หน้า ${opts.page}/${pages} · แตะงานเพื่อดูรายละเอียด`
                : 'แตะงานเพื่อดูรายละเอียด',
            size: 'xs',
            color: '#999999',
          },
        ],
      },
      body: { type: 'box', layout: 'vertical', paddingTop: 'none', contents: rows },
      footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: nav },
    },
  };
}
