import type { SessionRepository } from '../conversation/repository.js';
import type { Job, User } from '../db/schema.js';
import {
  LINK_PROVIDER,
  type JobRepository,
  type UserJobEntry,
  type UserJobRepository,
} from '../jobs/repository.js';
import { canonicalUrl, hostLabel, type LinkPreviewer } from '../links/preview.js';
import type { NoteRepository } from '../notes/repository.js';
import { jobCarousel, type CardJob } from './jobCards.js';
import type { OutgoingMessage } from './messenger.js';
import { isStage, STAGE_LABEL, STAGES } from './stages.js';
import { postbackButton, sayButton, text } from './ui.js';

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
  getAddFriendUrl?: () => string | undefined;
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

const notFound = () => [text('ไม่พบงานนี้แล้วครับ อาจถูกลบออกจากระบบ')];

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
  const timeZone = deps.timeZone ?? 'Asia/Bangkok';
  const fmtDate = new Intl.DateTimeFormat('th-TH', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  async function card(user: User, job: Job, entry: UserJobEntry | undefined) {
    const variant = entry?.status === 'applied' ? 'applied' : 'saved';
    const cardJob: CardJob = {
      ...job,
      stage: entry?.stage ?? null,
      noteCount: await notes.count(user.id, job.id),
    };
    return jobCarousel([{ job: cardJob }], variant, {
      altText: nameOf(job),
      addFriendUrl: deps.getAddFriendUrl?.(),
    });
  }

  /** The user sent a link: save the job and show it as a card. */
  async function addLink(user: User, rawUrl: string): Promise<OutgoingMessage[]> {
    const url = canonicalUrl(rawUrl);
    if (!url) {
      return [
        text(
          'ลิงก์นี้ใช้ไม่ได้ครับ 😅 ต้องขึ้นต้นด้วย http:// หรือ https:// และยาวไม่เกิน 1000 ตัวอักษร',
        ),
      ];
    }

    let job = await jobs.findByUrl(url);
    let needsTitle = false;
    if (!job) {
      const preview = await deps.previewLink(url);
      if (preview.source) {
        const { provider, board, externalId } = preview.source;
        job = await jobs.findBySource(provider, board, externalId);
      }
      if (!job) {
        const host = hostLabel(url);
        needsTitle = !preview.title;
        job = await jobs.createLinkJob({
          board: host,
          externalId: url,
          company: preview.company ?? preview.source?.board ?? host,
          title: preview.title ?? `งานจาก ${host}`,
          location: preview.location,
          department: preview.department,
          workplace: preview.workplace,
          url,
        });
      }
    }

    let entry = await userJobs.get(user.id, job.id);
    let heading: string;
    if (entry?.status === 'applied') {
      heading = `งานนี้อยู่ใน 📋 ที่สมัครไว้ อยู่แล้วครับ\nสถานะ: ${STAGE_LABEL[entry.stage ?? 'applied']}`;
    } else if (entry?.status === 'saved') {
      heading = 'งานนี้อยู่ใน ⭐ ที่เก็บไว้ อยู่แล้วครับ';
    } else {
      await userJobs.setStatus(user.id, job.id, 'saved');
      entry = { status: 'saved', stage: null };
      heading =
        '📥 บันทึกงานจากลิงก์ไว้ใน ⭐ ที่เก็บไว้ แล้วครับ\nถ้าสมัครแล้ว กด ✅ สมัครแล้ว ที่การ์ดได้เลย';
    }

    const out = [text(heading), await card(user, job, entry)];
    if (needsTitle && job.provider === LINK_PROVIDER) {
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

  /** Reply to the "what's this job called?" question after adding a link. */
  async function nameJob(user: User, jobId: string, input: string): Promise<OutgoingMessage[]> {
    await sessions.clear(user.id);
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    const parsed = parseTitleInput(input);
    if (CANCEL_WORDS.includes(input.trim().toLowerCase()) || !parsed) {
      return [text(`โอเคครับ ใช้ชื่อ "${job.title}" ไปก่อน`)];
    }
    // Only jobs users added themselves can be renamed; synced postings keep the board's data.
    if (job.provider !== LINK_PROVIDER) return [text('งานนี้ใช้ชื่อจากประกาศต้นทางครับ')];
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
    const [entry, list, total] = await Promise.all([
      userJobs.get(user.id, job.id),
      notes.list(user.id, job.id, DETAIL_NOTES),
      notes.count(user.id, job.id),
    ]);

    const lines = [`💼 ${job.title}`, `🏢 ${job.company}`];
    if (job.location) lines.push(`📍 ${job.location}`);
    if (entry?.status === 'applied') lines.push(`สถานะ: ${STAGE_LABEL[entry.stage ?? 'applied']}`);
    else if (entry?.status === 'saved') lines.push('สถานะ: ⭐ เก็บไว้');
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
    if (entry?.status === 'applied') buttons.push(stageButton(job), appliedListButton);
    else {
      buttons.push(postbackButton('✅ สมัครแล้ว', { a: 'job', v: 'apply', j: job.id }));
      buttons.push(savedListButton);
    }
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
    return [
      text(
        `🔄 งานนี้ถึงขั้นไหนแล้วครับ?\n${nameOf(job)}` +
          (current ? `\nตอนนี้: ${STAGE_LABEL[current]}` : ''),
        STAGES.filter((s) => s !== current).map((s) =>
          postbackButton(STAGE_LABEL[s], { a: 'stage', v: s, j: job.id }),
        ),
      ),
    ];
  }

  async function setStage(user: User, jobId: string, value: string): Promise<OutgoingMessage[]> {
    if (!isStage(value)) return [text('ไม่รู้จักสถานะนี้ครับ')];
    const job = await jobs.getById(jobId);
    if (!job) return notFound();
    await userJobs.setStage(user.id, job.id, value);

    const lines = [`อัปเดตแล้ว → ${STAGE_LABEL[value]}`, nameOf(job)];
    const buttons = [appliedListButton, detailButton(job)];
    switch (value) {
      case 'interview':
        lines.push('', '📅 จดวันเวลานัดไว้ในโน้ตก่อนได้เลยครับ (ระบบนัด + เตือนล่วงหน้ากำลังจะมา)');
        buttons.unshift(noteButton(job, '➕ จดวันนัด'));
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

  return { addLink, nameJob, skipTitle, detail, startNote, saveNote, stageMenu, setStage };
}
