import type { User } from '../db/schema.js';
import type { JobDistances } from '../geo/service.js';
import { rankJobs } from '../jobs/match.js';
import type { JobRepository, UserJobRepository, UserJobStatus } from '../jobs/repository.js';
import type { PrefsRepository } from '../prefs/repository.js';
import { jobCarousel } from './jobCards.js';
import {
  CARD_PAGE_SIZE,
  jobListMessage,
  LIST_PAGE_SIZE,
  LIST_TITLE,
  listData,
  type ListStatus,
  type ListView,
} from './jobList.js';
import type { OutgoingMessage } from './messenger.js';
import { stageStatus } from './stages.js';
import { postbackButton, text } from './ui.js';

export const FEED_PAGE_SIZE = 5;

export interface JobActionDeps {
  prefs: PrefsRepository;
  jobs: JobRepository;
  userJobs: UserJobRepository;
  /** e.g. https://line.me/R/ti/p/@abc1234 — appended to shared jobs when known. */
  getAddFriendUrl?: () => string | undefined;
  distances?: JobDistances;
  timeZone?: string;
  now?: () => Date;
}

const viewButton = (status: 'saved' | 'applied') =>
  status === 'saved'
    ? postbackButton('⭐ ดูที่เก็บไว้', { a: 'menu', m: 'saved' })
    : postbackButton('📋 ดูที่สมัครไว้', { a: 'menu', m: 'applied' });
const feedButton = postbackButton('🔍 ดูงานต่อ', { a: 'feed', p: '1' });
const editPrefsButton = postbackButton('⚙️ แก้ตั้งค่างาน', { a: 'prefs', v: 'edit' });

export function createJobActions(deps: JobActionDeps) {
  const { prefs, jobs, userJobs } = deps;
  const timeZone = deps.timeZone ?? 'Asia/Bangkok';
  const now = deps.now ?? (() => new Date());
  const distancesFor = (user: User, list: Parameters<JobDistances['forJobs']>[1]) =>
    deps.distances?.forJobs(user.id, list) ?? Promise.resolve(new Map<string, string>());
  const stationsFor = (list: Parameters<JobDistances['stationsFor']>[0]) =>
    deps.distances?.stationsFor(list) ?? Promise.resolve(new Map<string, string>());

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
    const [distances, stations] = await Promise.all([
      distancesFor(
        user,
        slice.map((r) => r.job),
      ),
      stationsFor(slice.map((r) => r.job)),
    ]);
    const companies = new Set(all.map((j) => j.company)).size;

    const header =
      page === 1
        ? `🔍 เจอ ${ranked.length} งานที่ตรงกับคุณ\n` +
          `(รวมจาก ${companies} บริษัท · ประกาศส่วนใหญ่ไม่ระบุเงินเดือน)`
        : `🔍 งานที่ ${start + 1}–${start + slice.length} จาก ${ranked.length}`;

    return [
      text(header),
      jobCarousel(
        slice.map((r) => ({
          job: {
            ...r.job,
            distanceText: distances.get(r.job.id),
            stationText: stations.get(r.job.id),
          },
          isNew: r.isNew,
        })),
        'feed',
        {
          altText: `งานที่ตรงกับคุณ ${slice.length} ตำแหน่ง`,
          more: hasMore ? { a: 'feed', p: String(page + 1) } : undefined,
          addFriendUrl: deps.getAddFriendUrl?.(),
        },
      ),
    ];
  }

  /**
   * Saved / applied jobs. 'list' is a compact, paged list (easy to scan when there are many);
   * 'card' is the familiar carousel with action buttons.
   */
  async function list(
    user: User,
    status: ListStatus,
    view: ListView = 'list',
    requestedPage = 1,
  ): Promise<OutgoingMessage[]> {
    const total = await userJobs.count(user.id, status);
    const title = LIST_TITLE[status];
    if (total === 0) {
      const hint =
        status === 'saved'
          ? 'กด ⭐ เก็บไว้ ที่การ์ดงาน หรือส่งลิงก์งานมาในแชท เพื่อเก็บไว้ดูทีหลัง'
          : 'สมัครงานแล้วกด ✅ สมัครแล้ว ที่การ์ดงาน ระบบจะจดไว้ให้';
      return [text(`${title}\nยังไม่มีงานครับ\n\n${hint}`, [feedButton])];
    }

    const size = view === 'list' ? LIST_PAGE_SIZE : CARD_PAGE_SIZE;
    const pages = Math.ceil(total / size);
    const page = Math.min(Math.max(1, requestedPage), pages);
    const listed = await userJobs.list(user.id, status, size, (page - 1) * size);
    const [distances, stations] = await Promise.all([
      distancesFor(
        user,
        listed.map((i) => i.job),
      ),
      stationsFor(listed.map((i) => i.job)),
    ]);
    const at = now();
    const items = listed.map((i) => ({
      ...i,
      stageText: i.stage ? stageStatus(i.stage, i.stageSince, at, timeZone) : undefined,
      distanceText: distances.get(i.job.id),
      stationText: stations.get(i.job.id),
    }));

    if (view === 'list') return [jobListMessage(items, status, { total, page })];

    const first = (page - 1) * size + 1;
    const nav = [
      postbackButton('📄 แบบรายการ', listData(status, 'list', Math.ceil(first / LIST_PAGE_SIZE))),
    ];
    if (page > 1) nav.push(postbackButton('◀ ก่อนหน้า', listData(status, 'card', page - 1)));
    if (page < pages) nav.push(postbackButton('ถัดไป ▶', listData(status, 'card', page + 1)));
    return [
      text(
        `${title} ${total} งาน${pages > 1 ? ` (${first}–${first + items.length - 1})` : ''}`,
        nav,
      ),
      jobCarousel(
        items.map(({ job, stage, stageText, distanceText, stationText, noteCount }) => ({
          job: { ...job, stage, stageText, distanceText, stationText, noteCount },
        })),
        status,
        {
          altText: `${title} ${total} งาน`,
          addFriendUrl: deps.getAddFriendUrl?.(),
          more: page < pages ? listData(status, 'card', page + 1) : undefined,
        },
      ),
    ];
  }

  async function act(user: User, action: string, jobId: string): Promise<OutgoingMessage[]> {
    const job = await jobs.getById(jobId);
    if (!job) return [text('ไม่พบงานนี้แล้วครับ อาจถูกลบออกจากระบบ')];
    const current = (await userJobs.get(user.id, job.id))?.status;
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
