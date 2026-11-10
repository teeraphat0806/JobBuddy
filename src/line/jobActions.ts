import type { User } from '../db/schema.js';
import { rankJobs } from '../jobs/match.js';
import type { JobRepository, UserJobRepository, UserJobStatus } from '../jobs/repository.js';
import type { PrefsRepository } from '../prefs/repository.js';
import { jobCarousel } from './jobCards.js';
import type { OutgoingMessage } from './messenger.js';
import { postbackButton, text } from './ui.js';

export const FEED_PAGE_SIZE = 5;
const LIST_LIMIT = 10;

export interface JobActionDeps {
  prefs: PrefsRepository;
  jobs: JobRepository;
  userJobs: UserJobRepository;
  /** e.g. https://line.me/R/ti/p/@abc1234 — appended to shared jobs when known. */
  getAddFriendUrl?: () => string | undefined;
}

const viewButton = (status: 'saved' | 'applied') =>
  status === 'saved'
    ? postbackButton('⭐ ดูที่เก็บไว้', { a: 'menu', m: 'saved' })
    : postbackButton('📋 ดูที่สมัครไว้', { a: 'menu', m: 'applied' });
const feedButton = postbackButton('🔍 ดูงานต่อ', { a: 'feed', p: '1' });
const editPrefsButton = postbackButton('⚙️ แก้ตั้งค่างาน', { a: 'prefs', v: 'edit' });

export function createJobActions(deps: JobActionDeps) {
  const { prefs, jobs, userJobs } = deps;

  /** "งานใหม่วันนี้": jobs matching the user's preferences, excluding ones they acted on. */
  async function feed(user: User, page: number): Promise<OutgoingMessage[] | 'needs-prefs'> {
    const p = await prefs.get(user.id);
    if (!p) return 'needs-prefs';

    const [all, statuses] = await Promise.all([jobs.listActive(), userJobs.statuses(user.id)]);
    if (all.length === 0) {
      return [text('⏳ ระบบกำลังรวบรวมงานอยู่ครับ ลองกดใหม่อีกสักครู่')];
    }

    const ranked = rankJobs(all, p, new Set(statuses.keys()));
    if (ranked.length === 0) {
      return [
        text(
          '😅 ยังไม่เจองานที่ตรงกับที่ตั้งไว้ครับ\n\n' +
            'ตอนนี้ JobBuddy รวมงานจากบริษัทอย่าง Agoda, Bosch, Grab, Lalamove และอื่นๆ\n' +
            'ลองเพิ่มตำแหน่งที่ใกล้เคียง หรือขยายพื้นที่ดูนะครับ',
          [editPrefsButton],
        ),
      ];
    }

    const start = (page - 1) * FEED_PAGE_SIZE;
    const slice = ranked.slice(start, start + FEED_PAGE_SIZE);
    if (slice.length === 0) {
      return [text('ดูครบทุกงานแล้วครับ 🎉 กลับมาดูใหม่พรุ่งนี้นะ', [feedButton])];
    }
    const hasMore = start + FEED_PAGE_SIZE < ranked.length;
    const companies = new Set(all.map((j) => j.company)).size;

    const header =
      page === 1
        ? `🔍 เจอ ${ranked.length} งานที่ตรงกับคุณ\n` +
          `(รวมจาก ${companies} บริษัท · ประกาศส่วนใหญ่ไม่ระบุเงินเดือน)`
        : `🔍 งานที่ ${start + 1}–${start + slice.length} จาก ${ranked.length}`;

    return [
      text(header),
      jobCarousel(
        slice.map((r) => ({ job: r.job, isNew: r.isNew })),
        'feed',
        {
          altText: `งานที่ตรงกับคุณ ${slice.length} ตำแหน่ง`,
          nextPage: hasMore ? page + 1 : undefined,
          addFriendUrl: deps.getAddFriendUrl?.(),
        },
      ),
    ];
  }

  async function list(user: User, status: 'saved' | 'applied'): Promise<OutgoingMessage[]> {
    const [items, total] = await Promise.all([
      userJobs.list(user.id, status, LIST_LIMIT),
      userJobs.count(user.id, status),
    ]);
    const title = status === 'saved' ? '⭐ งานที่เก็บไว้' : '📋 งานที่สมัครไว้';
    if (items.length === 0) {
      const hint =
        status === 'saved'
          ? 'กด ⭐ เก็บไว้ ที่การ์ดงาน เพื่อเก็บงานที่สนใจไว้ดูทีหลัง'
          : 'สมัครงานแล้วกด ✅ สมัครแล้ว ที่การ์ดงาน ระบบจะจดไว้ให้';
      return [text(`${title}\nยังไม่มีงานครับ\n\n${hint}`, [feedButton])];
    }
    const more = total > items.length ? ` (แสดง ${items.length} ล่าสุด)` : '';
    return [
      text(`${title} ${total} งาน${more}`),
      jobCarousel(
        items.map((job) => ({ job })),
        status,
        { altText: `${title} ${total} งาน`, addFriendUrl: deps.getAddFriendUrl?.() },
      ),
    ];
  }

  async function act(user: User, action: string, jobId: string): Promise<OutgoingMessage[]> {
    const job = await jobs.getById(jobId);
    if (!job) return [text('ไม่พบงานนี้แล้วครับ อาจถูกลบออกจากระบบ')];
    const current = await userJobs.getStatus(user.id, job.id);
    const name = `${job.title} @ ${job.company}`;

    const set = (s: UserJobStatus) => userJobs.setStatus(user.id, job.id, s);
    switch (action) {
      case 'save':
        if (current === 'applied')
          return [text(`งานนี้คุณสมัครไปแล้วครับ ✅\n${name}`, [viewButton('applied')])];
        await set('saved');
        return [text(`⭐ เก็บไว้แล้ว\n${name}`, [viewButton('saved'), feedButton])];
      case 'apply':
        await set('applied');
        return [
          text(`✅ บันทึกว่าสมัครแล้ว ขอให้ได้งานนะครับ 💪\n${name}`, [
            viewButton('applied'),
            feedButton,
          ]),
        ];
      case 'hide':
        if (current === 'applied')
          return [text(`งานนี้คุณสมัครไปแล้ว เลยไม่ซ่อนให้นะครับ\n${name}`)];
        await set('hidden');
        return [
          text(`❌ ซ่อนแล้ว จะไม่แสดงงานนี้อีก\n${name}`, [
            postbackButton('↩️ เลิกซ่อน', { a: 'job', v: 'unhide', j: job.id }),
            feedButton,
          ]),
        ];
      case 'unhide':
        if (current === 'hidden') await userJobs.clear(user.id, job.id);
        return [text(`↩️ แสดงงานนี้ในฟีดอีกครั้งแล้ว\n${name}`, [feedButton])];
      case 'unsave':
        if (current === 'saved') await userJobs.clear(user.id, job.id);
        return [text(`🗑️ เอาออกจากที่เก็บไว้แล้ว\n${name}`, [viewButton('saved')])];
      default:
        return [text('ไม่รู้จักคำสั่งนี้ครับ')];
    }
  }

  return { feed, list, act };
}
