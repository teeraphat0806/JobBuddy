import type { messagingApi } from '@line/bot-sdk';
import type { User } from '../db/schema.js';
import {
  SNOOZE_DAYS,
  type ClosedItem,
  type DigestRepository,
  type FollowUpItem,
} from '../followups/repository.js';
import type { ApplicationStage, JobRepository, UserJobRepository } from '../jobs/repository.js';
import type { OutgoingMessage } from './messenger.js';
import { encodePostback, type PostbackData } from './postback.js';
import { daysSince, stageStatus } from './stages.js';
import { postbackButton, sayButton, text } from './ui.js';

/** Bubbles per carousel (LINE allows 12; keep room and keep it readable). */
const MAX_BUBBLES = 10;
const MAX_CLOSED_NAMES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const appliedButton = postbackButton('📋 ที่สมัครไว้', { a: 'menu', m: 'applied' });
const savedButton = postbackButton('⭐ ที่เก็บไว้', { a: 'menu', m: 'saved' });
const remindersOffButton = sayButton('🔕 ปิดการเตือน', 'ปิดเตือน');

const truncate = (s: string, max: number) => {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…';
};

function button(
  label: string,
  data: PostbackData,
  style: 'primary' | 'secondary' | 'link' = 'secondary',
): messagingApi.FlexButton {
  return {
    type: 'button',
    style,
    height: 'sm',
    action: { type: 'postback', label, data: encodePostback(data), displayText: label },
  };
}

function followUpBubble(item: FollowUpItem, now: Date, tz: string): messagingApi.FlexBubble {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: truncate(item.title, 80), weight: 'bold', wrap: true, maxLines: 3 },
        { type: 'text', text: `🏢 ${item.company}`, size: 'sm', color: '#555555', wrap: true },
        {
          type: 'text',
          text: stageStatus(item.stage, item.stageSince, now, tz),
          size: 'sm',
          color: '#B45309',
          weight: 'bold',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        button('✉️ ร่างข้อความถาม', { a: 'fu', v: 'draft', j: item.jobId }, 'primary'),
        button('🔄 อัปเดตสถานะ', { a: 'job', v: 'stage', j: item.jobId }),
        button(`⏰ เตือนอีก ${SNOOZE_DAYS} วัน`, { a: 'fu', v: 'snooze', j: item.jobId }, 'link'),
      ],
    },
  };
}

/** The once-a-day push: applications worth a nudge, and saved jobs that closed. */
export function digestMessages(
  followUps: FollowUpItem[],
  closed: ClosedItem[],
  now: Date,
  tz: string,
): OutgoingMessage[] {
  const out: OutgoingMessage[] = [];
  if (followUps.length > 0) {
    const shown = followUps.slice(0, MAX_BUBBLES);
    const more = followUps.length - shown.length;
    out.push(
      text(
        `👋 มี ${followUps.length} งานที่สมัครไว้ยังไม่มีความคืบหน้ามาสักพักแล้วครับ\n` +
          'ลองทักไปถามดูไหม? กด "✉️ ร่างข้อความถาม" แล้วผมจะร่างให้' +
          (more > 0 ? `\n(แสดง ${shown.length} งานที่รอนานที่สุด อีก ${more} งานอยู่ใน 📋)` : ''),
      ),
    );
    out.push({
      type: 'flex',
      altText: `ติดตามงานที่สมัครไว้ ${followUps.length} งาน`,
      contents: { type: 'carousel', contents: shown.map((f) => followUpBubble(f, now, tz)) },
    });
  }

  const lines: string[] = [];
  if (closed.length > 0) {
    lines.push(`⛔ งานที่คุณเก็บไว้ปิดรับสมัครแล้ว ${closed.length} งาน:`);
    for (const c of closed.slice(0, MAX_CLOSED_NAMES)) {
      lines.push(`• ${truncate(c.title, 60)} · ${truncate(c.company, 30)}`);
    }
    if (closed.length > MAX_CLOSED_NAMES)
      lines.push(`…และอีก ${closed.length - MAX_CLOSED_NAMES} งาน`);
    lines.push('', 'งานที่ยังเปิดอยู่ใน ⭐ อย่าลืมรีบสมัครนะครับ');
  }
  lines.push((lines.length ? '\n' : '') + '🔕 ไม่อยากให้เตือนแบบนี้ พิมพ์ "ปิดเตือน" ได้เลยครับ');
  const buttons = [
    ...(followUps.length ? [appliedButton] : []),
    ...(closed.length ? [savedButton] : []),
    remindersOffButton,
  ];
  out.push(text(lines.join('\n'), buttons));
  return out;
}

function thaiDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', timeZone: tz }).format(
    d,
  );
}

function englishDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: tz }).format(
    d,
  );
}

/** A polite follow-up the user can copy, in Thai and English, worded for where things stand. */
export function followUpDrafts(
  job: { title: string; company: string },
  stage: ApplicationStage,
  since: Date,
  tz: string,
): [string, string] {
  const th = thaiDate(since, tz);
  const en = englishDate(since, tz);
  const { title, company } = job;
  switch (stage) {
    case 'contacted':
      return [
        `เรียน ฝ่ายบุคคล ${company}\n\n` +
          `ขอบคุณที่ติดต่อกลับเรื่องตำแหน่ง ${title} เมื่อวันที่ ${th} ครับ/ค่ะ ` +
          'ขออนุญาตสอบถามขั้นตอนถัดไปของการพิจารณา ยังสนใจตำแหน่งนี้มาก ' +
          'หากต้องการข้อมูลหรือเอกสารเพิ่มเติม ยินดีส่งให้ได้ทันทีครับ/ค่ะ\n\n' +
          'ขอบคุณครับ/ค่ะ\n[ชื่อ-นามสกุล]\n[เบอร์โทร]',
        `Dear ${company} Hiring Team,\n\n` +
          `Thank you for reaching out about the ${title} position on ${en}. ` +
          "I'd like to ask about the next steps in the process. I'm still very interested in the role " +
          'and happy to share anything else you need.\n\n' +
          'Best regards,\n[Your name]\n[Phone]',
      ];
    case 'waiting':
      return [
        `เรียน ฝ่ายบุคคล ${company}\n\n` +
          `ขอบคุณสำหรับโอกาสในการสัมภาษณ์ตำแหน่ง ${title} เมื่อวันที่ ${th} ครับ/ค่ะ ` +
          'ขออนุญาตสอบถามความคืบหน้าของผลการพิจารณา ยังสนใจร่วมงานกับทีมมาก ' +
          'หากต้องการข้อมูลเพิ่มเติม ยินดีส่งให้ได้ทันทีครับ/ค่ะ\n\n' +
          'ขอบคุณครับ/ค่ะ\n[ชื่อ-นามสกุล]\n[เบอร์โทร]',
        `Dear ${company} Hiring Team,\n\n` +
          `Thank you again for the opportunity to interview for the ${title} position on ${en}. ` +
          "I wanted to follow up on the status of my application. I'm still very excited about " +
          'the role and happy to provide anything else you need.\n\n' +
          'Best regards,\n[Your name]\n[Phone]',
      ];
    default:
      return [
        `เรียน ฝ่ายบุคคล ${company}\n\n` +
          `ผม/ดิฉัน [ชื่อ-นามสกุล] ได้สมัครงานตำแหน่ง ${title} เมื่อวันที่ ${th} ` +
          'ขออนุญาตสอบถามความคืบหน้าของการพิจารณาใบสมัครครับ/ค่ะ ยังสนใจตำแหน่งนี้มาก ' +
          'หากต้องการข้อมูลหรือเอกสารเพิ่มเติม ยินดีส่งให้ได้ทันทีครับ/ค่ะ\n\n' +
          'ขอบคุณครับ/ค่ะ\n[ชื่อ-นามสกุล]\n[เบอร์โทร]',
        `Dear ${company} Hiring Team,\n\n` +
          `I applied for the ${title} position on ${en} and wanted to follow up on my application. ` +
          "I'm still very interested in the role and happy to share any further information.\n\n" +
          'Best regards,\n[Your name]\n[Phone]',
      ];
  }
}

export interface FollowUpDeps {
  jobs: JobRepository;
  userJobs: UserJobRepository;
  digests?: DigestRepository | undefined;
  timeZone?: string | undefined;
  now?: (() => Date) | undefined;
}

export function createFollowUpFlows(deps: FollowUpDeps) {
  const tz = deps.timeZone ?? 'Asia/Bangkok';
  const now = deps.now ?? (() => new Date());
  const gone = () => [text('งานนี้ไม่ได้อยู่ใน 📋 ที่สมัครไว้แล้วครับ', [appliedButton])];

  async function draft(user: User, jobId: string): Promise<OutgoingMessage[]> {
    const [job, entry] = await Promise.all([
      deps.jobs.getById(jobId),
      deps.userJobs.get(user.id, jobId),
    ]);
    if (!job || entry?.status !== 'applied') return gone();
    const stage = entry.stage ?? 'applied';
    const since = entry.stageSince ?? now();
    const [th, en] = followUpDrafts(job, stage, since, tz);
    const days = daysSince(since, now(), tz);
    return [
      text(
        `✉️ ร่างข้อความถามความคืบหน้า "${truncate(job.title, 60)}" ให้แล้วครับ` +
          (days > 0 ? ` (รอมา ${days} วัน)` : '') +
          '\nกดค้างที่ข้อความเพื่อคัดลอก แก้ [ ] ให้เป็นของคุณ ' +
          'แล้วส่งทางอีเมลหรือช่องทางที่ใช้สมัคร',
      ),
      text(th),
      text(en, [
        postbackButton('🔄 อัปเดตสถานะ', { a: 'job', v: 'stage', j: jobId }),
        postbackButton(`⏰ เตือนอีก ${SNOOZE_DAYS} วัน`, { a: 'fu', v: 'snooze', j: jobId }),
        postbackButton('🔗 ดูงาน', { a: 'job', v: 'detail', j: jobId }),
      ]),
    ];
  }

  async function snooze(user: User, jobId: string): Promise<OutgoingMessage[]> {
    if (!deps.digests) return gone();
    const job = await deps.jobs.getById(jobId);
    const ok =
      job &&
      (await deps.digests.snooze(user.id, jobId, new Date(now().getTime() + SNOOZE_DAYS * DAY_MS)));
    if (!ok) return gone();
    return [
      text(
        `⏰ ได้ครับ จะเตือนเรื่อง "${truncate(job.title, 60)}" อีกครั้งใน ${SNOOZE_DAYS} วัน\n` +
          'ถ้าได้คำตอบก่อนนั้น กด "🔄 อัปเดตสถานะ" ได้เลย',
        [postbackButton('🔄 อัปเดตสถานะ', { a: 'job', v: 'stage', j: jobId }), appliedButton],
      ),
    ];
  }

  return { draft, snooze };
}
