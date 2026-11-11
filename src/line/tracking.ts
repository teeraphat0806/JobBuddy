import type { messagingApi } from '@line/bot-sdk';
import type { SessionRepository } from '../conversation/repository.js';
import type { Job, User } from '../db/schema.js';
import {
  LINK_PROVIDER,
  type ApplicationStage,
  type JobRepository,
  type UserJobEntry,
  type UserJobRepository,
} from '../jobs/repository.js';
import { directionsUrl } from '../geo/distance.js';
import type { JobDistances } from '../geo/service.js';
import { canonicalUrl, type LinkPreviewer } from '../links/preview.js';
import type { LinkImportRepository } from '../links/importRepository.js';
import {
  createLinkSaver,
  isPlaceholder,
  type SavedLink,
  type TrackedLink,
} from '../links/saveLink.js';
import type { NoteRepository } from '../notes/repository.js';
import { jobBubble, jobCarousel, type CardJob } from './jobCards.js';
import type { OutgoingMessage } from './messenger.js';
import { isStage, STAGE_LABEL, STAGES, stageStatus } from './stages.js';
import { linkButton, pickerButton, postbackButton, sayButton, text } from './ui.js';

/** Conversation flows owned by this module (stored in conversation_sessions.flow). */
export const NOTE_FLOW = 'note';
export const LINK_TITLE_FLOW = 'link-title';
const FLOW_TTL_MS = 10 * 60 * 1000;

const NOTE_MAX = 1000;
const DETAIL_NOTES = 10;
const LINE_TEXT_MAX = 5000;
export const CANCEL_WORDS = ['ยกเลิก', 'cancel'];

export interface TrackingDeps {
  jobs: JobRepository;
  userJobs: UserJobRepository;
  notes: NoteRepository;
  sessions: SessionRepository;
  previewLink: LinkPreviewer;
  timeZone?: string;
  now?: () => Date;
  getAddFriendUrl?: () => string | undefined;
  /** Background queue for messages with many links; without it only the first few are saved. */
  linkImports?: { repo: LinkImportRepository; kick: () => void };
  /** Distances from the user's home / condo; omitted means the feature is off. */
  distances?: JobDistances;
  /** Upcoming interview lines for a job, shown in its detail view. */
  interviewLines?: (user: User, jobId: string) => Promise<string[]>;
}

interface FlowState {
  jobId: string;
}

export function asFlowState(state: unknown): FlowState | null {
  return state && typeof state === 'object' && typeof (state as FlowState).jobId === 'string'
    ? (state as FlowState)
    : null;
}

const nameOf = (job: Job) => `${job.title} @ ${job.company}`;
const appliedListButton = postbackButton('📋 ดูที่สมัครไว้', { a: 'menu', m: 'applied' });
const savedListButton = postbackButton('⭐ ดูที่เก็บไว้', { a: 'menu', m: 'saved' });
const noteButton = (job: Job, label = '➕ จดโน้ต') =>
  postbackButton(label, { a: 'job', v: 'note', j: job.id });
const detailButton = (job: Job) =>
  postbackButton('📄 ดูโน้ต', { a: 'job', v: 'detail', j: job.id });
const stageButton = (job: Job) =>
  postbackButton('🔄 อัปเดตสถานะ', { a: 'job', v: 'stage', j: job.id });

const interviewButton = (job: Job, label = '📅 นัดสัมภาษณ์') =>
  pickerButton(label, { a: 'iv', v: 'new', j: job.id });

/** The encoded postback of a quick reply, if it is one (to avoid offering a button twice). */
const postbackDataOf = (b: messagingApi.QuickReplyItem) =>
  b.action?.type === 'postback' ? b.action.data : undefined;

const stageTap = (job: Job, stage: ApplicationStage, label = STAGE_LABEL[stage]) =>
  postbackButton(label, { a: 'stage', v: stage, j: job.id });

/**
 * The likely next steps from a stage, as buttons:
 * applied (waiting for a call) -> contacted -> interview booked / interviewed -> waiting for the
 * result -> offer or rejected.
 */
export function nextStepButtons(job: Job, stage: ApplicationStage) {
  const rejected = stageTap(job, 'rejected', '🙏 ไม่ผ่าน');
  switch (stage) {
    case 'applied':
      return [stageTap(job, 'contacted', '📞 ติดต่อกลับแล้ว'), rejected];
    case 'contacted':
      return [
        interviewButton(job, '📅 ยัง นัดสัมภาษณ์'),
        stageTap(job, 'waiting', '✅ สัมภาษณ์แล้ว'),
        rejected,
      ];
    case 'interview':
      return [stageTap(job, 'waiting', '✅ สัมภาษณ์แล้ว'), rejected];
    case 'waiting':
      return [stageTap(job, 'offer', '🎉 ได้งาน'), rejected];
    default:
      return [];
  }
}

const notFound = () => [text('ไม่พบงานนี้แล้วครับ อาจถูกลบออกจากระบบ')];

/** Up to this many links are saved right away, with cards in the reply. */
export const MAX_LINKS_PER_MESSAGE = 10;
/** More than that are queued; a LINE message (5000 characters) holds ~150 links at most. */
export const MAX_QUEUED_PER_MESSAGE = 500;
/** Links one user may have waiting at once, across messages. */
export const MAX_QUEUED_PER_USER = 2000;
const LINK_CONCURRENCY = 4;
const cannotRename = (job: Job) =>
  text(
    job.provider === LINK_PROVIDER
      ? 'งานนี้มีคนอื่นบันทึกไว้ด้วย เลยแก้ชื่อไม่ได้ครับ 🙏 จดชื่อที่ต้องการไว้ในโน้ตแทนได้นะ'
      : 'งานนี้ใช้ชื่อจากประกาศต้นทางครับ แก้ไม่ได้',
    [],
  );

/** "Data Analyst @ SCB" / "Data Analyst at SCB" -> title + company. */
export function parseTitleInput(input: string): { title: string; company?: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = /^(.+?)\s*(?:@|\sat\s|ที่บริษัท|บริษัท)\s*(.+)$/i.exec(trimmed);
  const title = [...(m ? m[1]! : trimmed)].slice(0, 200).join('').trim();
  const company = m ? [...m[2]!].slice(0, 100).join('').trim() : undefined;
  return title ? { title, ...(company ? { company } : {}) } : null;
}

export function createTracking(deps: TrackingDeps) {
  const { jobs, userJobs, notes, sessions } = deps;
  const saveLinkFor = createLinkSaver(deps);
  const timeZone = deps.timeZone ?? 'Asia/Bangkok';
  const now = deps.now ?? (() => new Date());
  /** "⏳ รอติดต่อกลับ · 5 วัน" for an applied job. */
  const statusOf = (entry: UserJobEntry) =>
    stageStatus(entry.stage ?? 'applied', entry.stageSince, now(), timeZone);
  const fmtDate = new Intl.DateTimeFormat('th-TH', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  async function card(user: User, job: Job, entry: UserJobEntry | undefined) {
    const variant = entry?.status === 'applied' ? 'applied' : 'saved';
    const distance = await deps.distances?.forJob(user.id, job);
    const cardJob: CardJob = {
      ...job,
      distanceText: distance?.text,
      stage: entry?.stage ?? null,
      stageText: entry?.status === 'applied' ? statusOf(entry) : undefined,
      noteCount: await notes.count(user.id, job.id),
    };
    return jobCarousel([{ job: cardJob }], variant, {
      altText: nameOf(job),
      addFriendUrl: deps.getAddFriendUrl?.(),
    });
  }

  const saveLink = (user: User, rawUrl: string) => saveLinkFor(user.id, rawUrl);

  const invalidLinkText =
    'ลิงก์นี้ใช้ไม่ได้ครับ 😅 ต้องขึ้นต้นด้วย http:// หรือ https:// และยาวไม่เกิน 1000 ตัวอักษร';

  /** Where an already-tracked job lives, e.g. "⭐ ที่เก็บไว้". */
  const whereIs = (entry: UserJobEntry) =>
    entry.status === 'applied' ? `📋 ที่สมัครไว้ (${statusOf(entry)})` : '⭐ ที่เก็บไว้';

  /** The user sent a link: save the job and show it as a card. */
  async function addLink(user: User, rawUrl: string): Promise<OutgoingMessage[]> {
    const saved = await saveLink(user, rawUrl);
    if (saved.kind === 'invalid') return [text(invalidLinkText)];
    const { job, entry } = saved;

    if (saved.kind !== 'new') {
      // Already in one of their lists: say so, and don't save it a second time.
      return [
        text(
          `🔁 ลิงก์นี้ซ้ำครับ งานนี้อยู่ใน ${whereIs(entry)} อยู่แล้ว เลยไม่ได้บันทึกซ้ำ\n\n${nameOf(job)}`,
          [detailButton(job), entry.status === 'applied' ? appliedListButton : savedListButton],
        ),
      ];
    }

    const out = [
      text(
        '📥 บันทึกงานจากลิงก์ไว้ใน ⭐ ที่เก็บไว้ แล้วครับ\nถ้าสมัครแล้ว กด ✅ สมัครแล้ว ที่การ์ดได้เลย',
      ),
      await card(user, job, entry),
    ];
    if (saved.needsTitle) {
      await sessions.set(user.id, LINK_TITLE_FLOW, { jobId: job.id }, FLOW_TTL_MS);
      out.push(
        text(
          'ผมอ่านชื่อตำแหน่งจากลิงก์นี้ไม่ได้ 😅\nพิมพ์ชื่อตำแหน่งให้หน่อยครับ เช่น\nData Analyst @ SCB',
          [postbackButton('ข้าม', { a: 'title', v: 'skip' })],
        ),
      );
    }
    return out;
  }

  /**
   * Several links in one message: save the new ones and report the rest. A link is a duplicate
   * when the job is already in the user's lists, or appears earlier in the same message (the
   * same URL, a tracking variant of it, or another link to the same posting).
   */
  async function addLinks(user: User, rawUrls: string[]): Promise<OutgoingMessage[]> {
    const urls = rawUrls.slice(0, MAX_LINKS_PER_MESSAGE);

    // Repeats of a URL earlier in the message are skipped before fetching anything.
    const seenUrls = new Set<string>();
    const toSave: string[] = [];
    let repeatedInMessage = 0;
    for (const raw of urls) {
      const key = canonicalUrl(raw) ?? raw;
      if (seenUrls.has(key)) {
        repeatedInMessage++;
        continue;
      }
      seenUrls.add(key);
      toSave.push(raw);
    }

    const results: SavedLink[] = [];
    // A few at a time: link previews hit other people's websites.
    for (let i = 0; i < toSave.length; i += LINK_CONCURRENCY) {
      const batch = toSave.slice(i, i + LINK_CONCURRENCY);
      results.push(...(await Promise.all(batch.map((u) => saveLink(user, u)))));
    }

    const added: TrackedLink[] = [];
    const already: TrackedLink[] = [];
    const seenJobs = new Set<string>();
    let invalid = 0;
    for (const r of results) {
      if (r.kind === 'invalid') {
        invalid++;
      } else if (seenJobs.has(r.job.id)) {
        repeatedInMessage++; // two different links to the same posting
      } else {
        seenJobs.add(r.job.id);
        if (r.kind === 'new') added.push(r);
        else already.push(r);
      }
    }
    const duplicates = already.length + repeatedInMessage;
    const untitled = added.filter((r) => r.needsTitle).length;

    const lines = [`📥 ได้รับ ${urls.length} ลิงก์`];
    if (added.length) {
      lines.push(`✅ บันทึกใหม่ ${added.length} งาน ใน ⭐ ที่เก็บไว้`);
      for (const r of added) lines.push(`• ${nameOf(r.job)}`);
    } else {
      lines.push('ไม่มีงานใหม่ให้บันทึกครับ');
    }
    if (duplicates) {
      lines.push('', `🔁 ลิงก์ซ้ำ ${duplicates} ลิงก์ (ไม่ได้บันทึกซ้ำ)`);
      for (const r of already) lines.push(`• ${nameOf(r.job)} — อยู่ใน ${whereIs(r.entry)} แล้ว`);
      if (repeatedInMessage)
        lines.push(`• ส่งลิงก์เดียวกันมาซ้ำในข้อความนี้ ${repeatedInMessage} ลิงก์`);
    }
    if (invalid) lines.push('', `⚠️ ใช้ไม่ได้ ${invalid} ลิงก์`);
    if (untitled) {
      lines.push(
        '',
        `✏️ มี ${untitled} งานที่อ่านชื่อไม่ได้ — กด "📝 โน้ต" ที่การ์ด แล้วกด ✏️ แก้ชื่อ`,
      );
    }
    if (rawUrls.length > MAX_LINKS_PER_MESSAGE) {
      lines.push(
        '',
        `(รับได้ครั้งละ ${MAX_LINKS_PER_MESSAGE} ลิงก์ ส่งที่เหลือมาอีกข้อความได้เลย)`,
      );
    }

    // Keep the summary within LINE's text limit even with long job names.
    const summary = [...lines.join('\n')].slice(0, LINE_TEXT_MAX).join('');
    const out: OutgoingMessage[] = [text(summary, [savedListButton])];
    if (added.length) {
      // Cards only for what was just saved; duplicates are already in the user's lists.
      const [counts, distances] = await Promise.all([
        Promise.all(added.map((r) => notes.count(user.id, r.job.id))),
        deps.distances?.forJobs(
          user.id,
          added.map((r) => r.job),
        ) ?? Promise.resolve(new Map<string, string>()),
      ]);
      out.push({
        type: 'flex',
        altText: `บันทึกงานจากลิงก์ ${added.length} งาน`,
        contents: {
          type: 'carousel',
          contents: added.slice(0, 12).map((r, i) =>
            jobBubble(
              {
                ...r.job,
                stage: r.entry.stage,
                noteCount: counts[i] ?? 0,
                distanceText: distances.get(r.job.id),
              },
              'saved',
              {
                addFriendUrl: deps.getAddFriendUrl?.(),
              },
            ),
          ),
        },
      });
    }
    return out;
  }

  /**
   * Many links in one message: queue them and answer right away (a reply has to go out within
   * about a minute). The worker reads one page per site at a time and pushes a summary when done.
   */
  async function queueLinks(user: User, rawUrls: string[]): Promise<OutgoingMessage[]> {
    const imports = deps.linkImports;
    if (!imports) return addLinks(user, rawUrls);
    const urls = rawUrls.slice(0, MAX_QUEUED_PER_MESSAGE);

    const seen = new Set<string>();
    const unique: string[] = [];
    let repeated = 0;
    for (const raw of urls) {
      const key = canonicalUrl(raw) ?? raw;
      if (seen.has(key)) repeated++;
      else {
        seen.add(key);
        unique.push(raw);
      }
    }

    const room = Math.max(0, MAX_QUEUED_PER_USER - (await imports.repo.queuedCount(user.id)));
    if (room === 0) {
      return [
        text(
          `⏳ ตอนนี้มีลิงก์รอบันทึกอยู่ ${MAX_QUEUED_PER_USER} ลิงก์แล้วครับ (เต็มคิว)\n` +
            'รอให้บันทึกเสร็จก่อน แล้วค่อยส่งที่เหลือมาใหม่นะครับ',
        ),
      ];
    }
    const queued = unique.slice(0, room);
    const dropped = unique.length - queued.length + (rawUrls.length - urls.length);
    await imports.repo.enqueue(user.id, queued, queued.length + repeated, repeated);
    imports.kick();

    // Pages on one site are read one per second, so the busiest site sets the pace.
    const perSite = new Map<string, number>();
    for (const u of queued) {
      let host = '';
      try {
        host = new URL(u).hostname;
      } catch {
        // invalid links are reported in the summary
      }
      perSite.set(host, (perSite.get(host) ?? 0) + 1);
    }
    const minutes = Math.max(1, Math.ceil((Math.max(...perSite.values()) * 1.2) / 60));

    const lines = [
      `📥 ได้รับ ${urls.length} ลิงก์ กำลังทยอยบันทึกให้ครับ`,
      `⏱️ ใช้เวลาประมาณ ${minutes} นาที (อ่านทีละหน้า ไม่รัวเว็บต้นทาง)`,
      'เสร็จแล้วจะส่งสรุปให้ในแชทนี้ ระหว่างนี้ใช้งานอย่างอื่นได้ตามปกติ',
    ];
    if (repeated) lines.push('', `🔁 ลิงก์ซ้ำในข้อความนี้ ${repeated} ลิงก์ (ไม่ได้บันทึกซ้ำ)`);
    if (dropped) {
      lines.push(
        '',
        `⚠️ เกินคิว ${dropped} ลิงก์ไม่ได้รับ — รับได้ครั้งละ ${MAX_QUEUED_PER_USER} ลิงก์ ` +
          'ส่งมาใหม่หลังได้สรุปแล้วนะครับ',
      );
    }
    return [text(lines.join('\n'), [savedListButton])];
  }

  /**
   * Link jobs are shared by everyone who saved the same URL, so a rename is only allowed while
   * the job has no real title yet, or when nobody else has it in their list.
   */
  async function canRename(user: User, job: Job): Promise<boolean> {
    if (job.provider !== LINK_PROVIDER) return false;
    if (isPlaceholder(job)) return true;
    return (await userJobs.otherTrackers(user.id, job.id)) === 0;
  }

  /** "✏️ แก้ชื่อ" from the detail view. */
  async function askTitle(user: User, jobId: string): Promise<OutgoingMessage[]> {
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    if (!(await canRename(user, job))) return [cannotRename(job)];
    await sessions.set(user.id, LINK_TITLE_FLOW, { jobId: job.id }, FLOW_TTL_MS);
    return [
      text(`✏️ พิมพ์ชื่อใหม่ได้เลยครับ เช่น\nData Analyst @ SCB\n\nตอนนี้: ${nameOf(job)}`, [
        sayButton('ยกเลิก'),
      ]),
    ];
  }

  /** Reply to the "what's this job called?" question. */
  async function nameJob(user: User, jobId: string, input: string): Promise<OutgoingMessage[]> {
    await sessions.clear(user.id);
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    const parsed = parseTitleInput(input);
    if (CANCEL_WORDS.includes(input.trim().toLowerCase()) || !parsed) {
      return [text(`โอเคครับ ใช้ชื่อ "${job.title}" ไปก่อน`)];
    }
    if (!(await canRename(user, job))) return [cannotRename(job)];
    await jobs.rename(job.id, parsed.title, parsed.company);
    const renamed = { ...job, title: parsed.title, company: parsed.company ?? job.company };
    return [
      text(`✏️ ตั้งชื่อแล้ว: ${nameOf(renamed)}`),
      await card(user, renamed, await userJobs.get(user.id, job.id)),
    ];
  }

  async function skipTitle(user: User): Promise<OutgoingMessage[]> {
    await sessions.clear(user.id);
    return [text('โอเคครับ 👍', [savedListButton])];
  }

  /** Job summary with status and notes. */
  async function detail(user: User, jobId: string): Promise<OutgoingMessage[]> {
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    const [entry, list, total, ivLines, distance] = await Promise.all([
      userJobs.get(user.id, job.id),
      notes.list(user.id, job.id, DETAIL_NOTES),
      notes.count(user.id, job.id),
      deps.interviewLines?.(user, job.id) ?? Promise.resolve([]),
      deps.distances?.forJob(user.id, job) ?? Promise.resolve(null),
    ]);

    const lines = [`💼 ${job.title}`, `🏢 ${job.company}`];
    if (job.location) lines.push(`📍 ${job.location}`);
    if (distance) lines.push(`📏 ${distance.text} (เส้นตรง)`);
    if (entry?.status === 'applied') lines.push(`สถานะ: ${statusOf(entry)}`);
    else if (entry?.status === 'saved') lines.push('สถานะ: ⭐ เก็บไว้');
    lines.push(...ivLines);
    lines.push(`🔗 ${job.url}`, '');
    if (total === 0) {
      lines.push(
        '📝 ยังไม่มีโน้ต — กด ➕ จดโน้ต เพื่อจดอะไรก็ได้ เช่น ชื่อ HR, เงินเดือนที่คุยไว้',
      );
    } else {
      lines.push(
        `📝 โน้ต ${total} รายการ${total > list.length ? ` (แสดง ${list.length} ล่าสุด)` : ''}`,
      );
      for (const n of list) lines.push(`• ${fmtDate.format(n.createdAt)} — ${n.body}`);
    }
    let body = lines.join('\n');
    if (body.length > LINE_TEXT_MAX) body = body.slice(0, LINE_TEXT_MAX - 1) + '…';

    const buttons = [noteButton(job)];
    if (job.url.length <= 1000) buttons.push(linkButton('🔗 เปิดประกาศ', job.url));
    if (distance) buttons.push(linkButton('🗺️ เส้นทาง', directionsUrl(distance.to)));
    if (entry?.status === 'applied') {
      const next = nextStepButtons(job, entry.stage ?? 'applied');
      buttons.unshift(...next);
      buttons.push(stageButton(job));
      if (!next.some((b) => b.action?.type === 'datetimepicker'))
        buttons.push(interviewButton(job));
    } else {
      buttons.push(postbackButton('✅ สมัครแล้ว', { a: 'job', v: 'apply', j: job.id }));
    }
    if (await canRename(user, job)) {
      buttons.push(postbackButton('✏️ แก้ชื่อ', { a: 'title', v: 'edit', j: job.id }));
    }
    buttons.push(entry?.status === 'applied' ? appliedListButton : savedListButton);
    return [text(body, buttons)];
  }

  async function startNote(user: User, jobId: string): Promise<OutgoingMessage[]> {
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    await sessions.set(user.id, NOTE_FLOW, { jobId: job.id }, FLOW_TTL_MS);
    return [text(`📝 พิมพ์โน้ตสำหรับงานนี้ได้เลยครับ\n${nameOf(job)}`, [sayButton('ยกเลิก')])];
  }

  async function saveNote(user: User, jobId: string, input: string): Promise<OutgoingMessage[]> {
    await sessions.clear(user.id);
    if (CANCEL_WORDS.includes(input.trim().toLowerCase())) return [text('ยกเลิกการจดโน้ตแล้วครับ')];
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    const body = [...input.trim()].slice(0, NOTE_MAX).join('');
    if (!body) return [text('โน้ตว่างอยู่ครับ ไม่ได้บันทึกนะ')];

    await notes.add(user.id, job.id, body);
    // A note means the user cares about this job: make sure it shows up in their lists.
    if (!(await userJobs.get(user.id, job.id))) await userJobs.setStatus(user.id, job.id, 'saved');
    const total = await notes.count(user.id, job.id);
    return [
      text(`📝 จดแล้ว (งานนี้มี ${total} โน้ต)\n${nameOf(job)}`, [
        detailButton(job),
        noteButton(job, '➕ จดเพิ่ม'),
      ]),
    ];
  }

  async function stageMenu(user: User, jobId: string): Promise<OutgoingMessage[]> {
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    const entry = await userJobs.get(user.id, job.id);
    const current = entry?.status === 'applied' ? (entry.stage ?? 'applied') : null;
    // Likely next steps first, then any other stage (to fix a mistake).
    const next = current ? nextStepButtons(job, current) : [];
    const offered = new Set(next.map(postbackDataOf));
    const others = STAGES.filter((st) => st !== current)
      .map((st) => stageTap(job, st))
      .filter((b) => !offered.has(postbackDataOf(b)));
    return [
      text(
        `🔄 งานนี้ถึงขั้นไหนแล้วครับ?\n${nameOf(job)}` +
          (entry && current ? `\nตอนนี้: ${statusOf(entry)}` : ''),
        [...next, ...others],
      ),
    ];
  }

  async function setStage(user: User, jobId: string, value: string): Promise<OutgoingMessage[]> {
    if (!isStage(value)) return [text('ไม่รู้จักสถานะนี้ครับ')];
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    const before = await userJobs.get(user.id, job.id);
    await userJobs.setStage(user.id, job.id, value);
    const entry = (await userJobs.get(user.id, job.id)) ?? {
      status: 'applied' as const,
      stage: value,
      stageSince: now(),
    };
    const restarted = before?.stage !== value;

    const lines = [`อัปเดตแล้ว → ${statusOf(entry)}`, nameOf(job)];
    const buttons = [...nextStepButtons(job, value), detailButton(job), appliedListButton];
    switch (value) {
      case 'applied':
        if (restarted) lines.push('', '⏳ เริ่มนับวันรอติดต่อกลับ ถ้ามีการติดต่อกลับ กด 📞 ได้เลย');
        break;
      case 'contacted':
        lines.push('', '📞 เยี่ยมเลย! สัมภาษณ์แล้วหรือยังครับ?');
        break;
      case 'waiting':
        if (restarted) lines.push('', '⏳ เริ่มนับวันรอผลใหม่ ได้ผลแล้วกด 🎉 หรือ 🙏 ได้เลย');
        break;
      case 'interview':
        lines.push('', '📅 กดเลือกวันเวลานัด แล้วระบบจะเตือนให้ก่อนวันสัมภาษณ์ครับ');
        buttons.unshift(interviewButton(job));
        break;
      case 'offer':
        lines.push('', 'ยินดีด้วยครับ!! 🎉🎉');
        break;
      case 'rejected':
        lines.push('', 'ไม่เป็นไรนะครับ ที่ใหม่ที่ดีกว่ารออยู่ สู้ต่อ 💪');
        buttons.push(postbackButton('🔍 หางานต่อ', { a: 'feed', p: '1' }));
        break;
    }
    return [text(lines.join('\n'), buttons)];
  }

  return {
    addLink,
    addLinks,
    queueLinks,
    askTitle,
    nameJob,
    skipTitle,
    detail,
    startNote,
    saveNote,
    stageMenu,
    setStage,
  };
}
