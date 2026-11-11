import type { messagingApi } from '@line/bot-sdk';
import type { SessionRepository } from '../conversation/repository.js';
import type { Interview, Job, User } from '../db/schema.js';
import type { InterviewRepository, ReminderKind } from '../interviews/repository.js';
import {
  formatWhen,
  parsePickerValue,
  parseWhen,
  relativeDay,
  toPickerValue,
} from '../interviews/time.js';
import type { JobRepository, UserJobRepository } from '../jobs/repository.js';
import type { UserRepository } from '../users/repository.js';
import type { OutgoingMessage } from './messenger.js';
import { encodePostback, type PostbackData } from './postback.js';
import { linkButton, pickerAction, pickerButton, postbackButton, sayButton, text } from './ui.js';

export const IV_TIME_FLOW = 'iv-time';
export const IV_PLACE_FLOW = 'iv-place';
const FLOW_TTL_MS = 10 * 60 * 1000;
const LIST_LIMIT = 10;
const PLACE_MAX = 300;
const CANCEL_WORDS = ['ยกเลิก', 'cancel'];
export const REMINDER_OFF_WORDS = ['ปิดเตือน', 'ปิดการเตือน'];
export const REMINDER_ON_WORDS = ['เปิดเตือน', 'เปิดการเตือน'];

export interface InterviewDeps {
  interviews: InterviewRepository;
  jobs: JobRepository;
  userJobs: UserJobRepository;
  users: UserRepository;
  sessions: SessionRepository;
  timeZone?: string;
  now?: () => Date;
}

interface TimeFlowState {
  jobId: string;
  interviewId?: string;
}
interface PlaceFlowState {
  interviewId: string;
}

export const asTimeFlow = (s: unknown): TimeFlowState | null =>
  s && typeof s === 'object' && typeof (s as TimeFlowState).jobId === 'string'
    ? (s as TimeFlowState)
    : null;
export const asPlaceFlow = (s: unknown): PlaceFlowState | null =>
  s && typeof s === 'object' && typeof (s as PlaceFlowState).interviewId === 'string'
    ? (s as PlaceFlowState)
    : null;

const isUrl = (s: string | null): s is string => !!s && /^https?:\/\/\S+$/i.test(s);
const nameOf = (job: Job) => `${job.title} @ ${job.company}`;
const listButton = postbackButton('📅 ดูนัดทั้งหมด', { a: 'menu', m: 'interviews' });

/** Picker defaults: tomorrow 10:00, nothing earlier than now. */
function pickerOpts(now: Date, tz: string) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return {
    initial: `${toPickerValue(tomorrow, tz).slice(0, 10)}T10:00`,
    min: toPickerValue(now, tz),
  };
}

export function interviewPicker(
  label: string,
  data: PostbackData,
  now: Date,
  tz: string,
): messagingApi.QuickReplyItem {
  return pickerButton(label, data, pickerOpts(now, tz));
}

function placeLine(place: string | null): string[] {
  if (!place) return [];
  return [isUrl(place) ? '💻 ออนไลน์ (มีลิงก์)' : `📍 ${place}`];
}

/** Text pushed before an interview. */
export function reminderMessage(
  kind: ReminderKind,
  iv: Interview,
  job: Job,
  tz: string,
  now: Date,
): OutgoingMessage {
  const minutes = Math.round((iv.startsAt.getTime() - now.getTime()) / 60_000);
  const lead =
    kind === 'evening'
      ? `⏰ ${relativeDay(iv.startsAt, now, tz)}มีสัมภาษณ์นะครับ`
      : minutes >= 90
        ? `⏰ อีกประมาณ ${Math.round(minutes / 60)} ชั่วโมงจะสัมภาษณ์แล้ว!`
        : `⏰ อีก ${minutes} นาทีจะสัมภาษณ์แล้ว!`;
  const lines = [
    lead,
    '',
    `💼 ${job.title}`,
    `🏢 ${job.company}`,
    `🕑 ${formatWhen(iv.startsAt, tz, now)}`,
    ...placeLine(iv.place),
    '',
    kind === 'evening' ? 'เตรียมตัวให้พร้อม พักผ่อนเยอะๆ สู้ๆ 💪' : 'ขอให้โชคดีครับ 🍀',
  ];
  const buttons = [postbackButton('📄 ดูโน้ต', { a: 'job', v: 'detail', j: job.id })];
  if (isUrl(iv.place) && iv.place.length <= 1000) {
    buttons.unshift(linkButton('🔗 เข้าห้องสัมภาษณ์', iv.place));
  }
  return text(lines.join('\n'), buttons);
}

function flexButton(
  label: string,
  action: messagingApi.Action,
  style: 'primary' | 'secondary' = 'secondary',
): messagingApi.FlexButton {
  return {
    type: 'button',
    style,
    height: 'sm',
    ...(style === 'primary' ? { color: '#06C755' } : {}),
    action: { ...action, label } as messagingApi.Action,
  };
}

function postback(label: string, data: PostbackData): messagingApi.PostbackAction {
  return { type: 'postback', label, data: encodePostback(data), displayText: label };
}

export function interviewBubble(
  iv: Interview,
  job: Job,
  now: Date,
  tz: string,
): messagingApi.FlexBubble {
  const body: messagingApi.FlexComponent[] = [
    {
      type: 'text',
      text: `🕑 ${formatWhen(iv.startsAt, tz, now)}`,
      weight: 'bold',
      color: '#06C755',
      wrap: true,
    },
    { type: 'text', text: relativeDay(iv.startsAt, now, tz), size: 'xs', color: '#999999' },
    { type: 'text', text: job.title, size: 'lg', weight: 'bold', wrap: true, maxLines: 3 },
    { type: 'text', text: job.company, size: 'sm', color: '#555555', wrap: true, maxLines: 1 },
  ];
  for (const line of placeLine(iv.place)) {
    body.push({ type: 'text', text: line, size: 'sm', color: '#555555', wrap: true, maxLines: 3 });
  }

  const row = (...contents: messagingApi.FlexComponent[]): messagingApi.FlexBox => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents,
  });
  const footer: messagingApi.FlexComponent[] = [];
  if (isUrl(iv.place) && iv.place.length <= 1000) {
    footer.push(flexButton('🔗 เข้าห้องสัมภาษณ์', { type: 'uri', uri: iv.place }, 'primary'));
  }
  footer.push(
    row(
      flexButton(
        '✏️ เปลี่ยนเวลา',
        pickerAction(
          '✏️ เปลี่ยนเวลา',
          { a: 'iv', v: 'move', i: iv.id },
          {
            initial: toPickerValue(iv.startsAt, tz),
            min: toPickerValue(now, tz),
          },
        ),
      ),
      flexButton('📍 สถานที่', postback('📍 สถานที่', { a: 'iv', v: 'place', i: iv.id })),
    ),
    row(
      flexButton('📝 โน้ต', postback('📝 โน้ต', { a: 'job', v: 'detail', j: job.id })),
      flexButton('🗑️ ยกเลิกนัด', postback('🗑️ ยกเลิกนัด', { a: 'iv', v: 'del', i: iv.id })),
    ),
  );
  return {
    type: 'bubble',
    size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer },
  };
}

export function createInterviewFlows(deps: InterviewDeps) {
  const { interviews, jobs, userJobs, users, sessions } = deps;
  const tz = deps.timeZone ?? 'Asia/Bangkok';
  const now = deps.now ?? (() => new Date());

  const reminderNote = (user: User) =>
    user.notifyInterviewReminders
      ? '⏰ จะเตือนคืนก่อนวันนัด (19:00) และ 2 ชม. ก่อนเริ่ม'
      : '🔕 การเตือนปิดอยู่ — พิมพ์ "เปิดเตือน" ถ้าอยากให้เตือน';

  function scheduled(user: User, iv: Interview, job: Job, verb: string): OutgoingMessage[] {
    const t = now();
    return [
      text(
        [
          `📅 ${verb}`,
          `💼 ${nameOf(job)}`,
          `🕑 ${formatWhen(iv.startsAt, tz, t)} (${relativeDay(iv.startsAt, t, tz)})`,
          ...placeLine(iv.place),
          '',
          reminderNote(user),
        ].join('\n'),
        [
          ...(iv.place
            ? []
            : [postbackButton('📍 ใส่สถานที่/ลิงก์', { a: 'iv', v: 'place', i: iv.id })]),
          postbackButton('📝 จดโน้ต', { a: 'job', v: 'note', j: job.id }),
          listButton,
        ],
      ),
    ];
  }

  async function book(user: User, job: Job, startsAt: Date): Promise<OutgoingMessage[]> {
    const iv = await interviews.create(user.id, job.id, startsAt);
    // An interview means the application reached that stage.
    const entry = await userJobs.get(user.id, job.id);
    if (entry?.status !== 'applied' || !['offer', 'rejected'].includes(entry.stage ?? '')) {
      await userJobs.setStage(user.id, job.id, 'interview');
    }
    return scheduled(user, iv, job, 'นัดสัมภาษณ์แล้วครับ');
  }

  const pastTime = (when: Date) =>
    text(`เวลา ${formatWhen(when, tz, now())} ผ่านไปแล้วครับ 😅 เลือกเวลาใหม่อีกครั้งนะ`);

  /** "📅 นัดสัมภาษณ์" for a job: open the picker (or type a time). */
  async function ask(user: User, jobId: string, interviewId?: string): Promise<OutgoingMessage[]> {
    const job = await jobs.getById(jobId);
    if (!job) return [text('ไม่พบงานนี้แล้วครับ')];
    await sessions.set(user.id, IV_TIME_FLOW, { jobId, interviewId }, FLOW_TTL_MS);
    const data: PostbackData = interviewId
      ? { a: 'iv', v: 'move', i: interviewId }
      : { a: 'iv', v: 'new', j: jobId };
    return [
      text(
        `📅 สัมภาษณ์วันไหน เวลาเท่าไหร่ครับ?\n${nameOf(job)}\n\n` +
          'กดปุ่มเลือกวันเวลา หรือพิมพ์ก็ได้ เช่น\n• พรุ่งนี้ บ่ายสอง\n• 15/11 10:30\n• ศุกร์ 9 โมงเช้า',
        [interviewPicker('📅 เลือกวันเวลา', data, now(), tz), sayButton('ยกเลิก')],
      ),
    ];
  }

  /** Picker result for a new interview. */
  async function create(user: User, jobId: string, dt: string | undefined) {
    if (!dt) return ask(user, jobId);
    await sessions.clear(user.id);
    const job = await jobs.getById(jobId);
    if (!job) return [text('ไม่พบงานนี้แล้วครับ')];
    const when = parsePickerValue(dt, tz);
    if (!when) return [text('อ่านวันเวลาไม่ออกครับ ลองใหม่อีกครั้งนะ')];
    if (when <= now()) return [pastTime(when)];
    return book(user, job, when);
  }

  async function move(user: User, interviewId: string, dt: string | undefined) {
    const found = await interviews.get(user.id, interviewId);
    if (!found) return [text('ไม่พบนัดนี้แล้วครับ')];
    if (!dt) return ask(user, found.job.id, interviewId);
    await sessions.clear(user.id);
    const when = parsePickerValue(dt, tz);
    if (!when) return [text('อ่านวันเวลาไม่ออกครับ ลองใหม่อีกครั้งนะ')];
    if (when <= now()) return [pastTime(when)];
    await interviews.reschedule(user.id, interviewId, when);
    return scheduled(
      user,
      { ...found.interview, startsAt: when },
      found.job,
      'เปลี่ยนเวลานัดแล้วครับ',
    );
  }

  /**
   * Typed reply while we wait for a time. Returns null when the text clearly isn't a time,
   * so the caller can handle it normally (the user moved on).
   */
  async function typedTime(
    user: User,
    state: TimeFlowState,
    input: string,
  ): Promise<OutgoingMessage[] | null> {
    if (CANCEL_WORDS.includes(input.trim().toLowerCase())) {
      await sessions.clear(user.id);
      return [text('โอเคครับ ยกเลิกแล้ว')];
    }
    const parsed = parseWhen(input, now(), tz);
    switch (parsed.kind) {
      case 'invalid':
        await sessions.clear(user.id);
        return null;
      case 'no-time':
        return [text('กี่โมงครับ? พิมพ์วันพร้อมเวลาเลยนะ เช่น "พรุ่งนี้ 14:00"')];
      case 'past':
        return [pastTime(parsed.date)];
      case 'ok': {
        await sessions.clear(user.id);
        if (state.interviewId) {
          const found = await interviews.get(user.id, state.interviewId);
          if (!found) return [text('ไม่พบนัดนี้แล้วครับ')];
          await interviews.reschedule(user.id, state.interviewId, parsed.date);
          return scheduled(
            user,
            { ...found.interview, startsAt: parsed.date },
            found.job,
            'เปลี่ยนเวลานัดแล้วครับ',
          );
        }
        const job = await jobs.getById(state.jobId);
        if (!job) return [text('ไม่พบงานนี้แล้วครับ')];
        return book(user, job, parsed.date);
      }
    }
  }

  async function askPlace(user: User, interviewId: string): Promise<OutgoingMessage[]> {
    const found = await interviews.get(user.id, interviewId);
    if (!found) return [text('ไม่พบนัดนี้แล้วครับ')];
    await sessions.set(user.id, IV_PLACE_FLOW, { interviewId }, FLOW_TTL_MS);
    return [
      text('📍 สัมภาษณ์ที่ไหนครับ? พิมพ์ที่อยู่ หรือวางลิงก์ Zoom / Google Meet / Teams ได้เลย', [
        sayButton('💻 ออนไลน์', 'ออนไลน์'),
        sayButton('ยกเลิก'),
      ]),
    ];
  }

  async function savePlace(user: User, state: PlaceFlowState, input: string) {
    await sessions.clear(user.id);
    if (CANCEL_WORDS.includes(input.trim().toLowerCase())) return [text('โอเคครับ ยกเลิกแล้ว')];
    const place = [...input.trim()].slice(0, PLACE_MAX).join('');
    const found = await interviews.get(user.id, state.interviewId);
    if (!found || !place) return [text('ไม่พบนัดนี้แล้วครับ')];
    await interviews.setPlace(user.id, state.interviewId, place);
    return scheduled(user, { ...found.interview, place }, found.job, 'บันทึกสถานที่แล้วครับ');
  }

  async function confirmRemove(user: User, interviewId: string) {
    const found = await interviews.get(user.id, interviewId);
    if (!found) return [text('ไม่พบนัดนี้แล้วครับ')];
    return [
      text(
        `ยกเลิกนัดนี้ใช่ไหมครับ?\n${nameOf(found.job)}\n🕑 ${formatWhen(found.interview.startsAt, tz, now())}`,
        [
          postbackButton('🗑️ ยกเลิกนัด', { a: 'iv', v: 'delok', i: interviewId }),
          postbackButton('ไม่ยกเลิก', { a: 'menu', m: 'interviews' }),
        ],
      ),
    ];
  }

  async function remove(user: User, interviewId: string) {
    const ok = await interviews.remove(user.id, interviewId);
    return [text(ok ? '🗑️ ยกเลิกนัดแล้วครับ' : 'ไม่พบนัดนี้แล้วครับ', [listButton])];
  }

  async function list(user: User): Promise<OutgoingMessage[]> {
    const t = now();
    const items = await interviews.upcoming(user.id, t, LIST_LIMIT);
    const toggle = user.notifyInterviewReminders
      ? sayButton('🔕 ปิดเตือน', 'ปิดเตือน')
      : sayButton('🔔 เปิดเตือน', 'เปิดเตือน');
    if (items.length === 0) {
      return [
        text(
          '📅 ยังไม่มีนัดสัมภาษณ์ที่กำลังจะถึงครับ\n\n' +
            'เวลาได้นัด ไปที่ 📋 ที่สมัครไว้ แล้วกด "📅 นัดสัมภาษณ์" ที่การ์ดงาน ' +
            'ระบบจะเตือนให้ก่อนวันนัด',
          [postbackButton('📋 ที่สมัครไว้', { a: 'menu', m: 'applied' }), toggle],
        ),
      ];
    }
    return [
      text(`📅 นัดที่กำลังจะถึง ${items.length} นัด\n${reminderNote(user)}`, [toggle]),
      {
        type: 'flex',
        altText: `นัดสัมภาษณ์ ${items.length} นัด`,
        contents: {
          type: 'carousel',
          contents: items.map(({ interview, job }) => interviewBubble(interview, job, t, tz)),
        },
      },
    ];
  }

  async function setReminders(user: User, on: boolean): Promise<OutgoingMessage[]> {
    await users.setReminders(user.id, on);
    return [
      text(
        on
          ? '🔔 เปิดการเตือนแล้วครับ\n• เตือนก่อนวันนัดสัมภาษณ์\n• ชวนติดตามงานที่สมัครไว้เมื่อเงียบไป 7 วัน และแจ้งเมื่องานที่เก็บไว้ปิดรับ (วันละไม่เกิน 1 ข้อความ)'
          : '🔕 ปิดการเตือนทั้งหมดแล้วครับ (นัดสัมภาษณ์ + ติดตามงาน)\nพิมพ์ "เปิดเตือน" เมื่อไหร่ก็ได้',
        [listButton],
      ),
    ];
  }

  /** Upcoming interviews for one job, for the job detail view. */
  async function linesForJob(user: User, jobId: string): Promise<string[]> {
    const t = now();
    const list = await interviews.upcomingForJob(user.id, jobId, t);
    return list.map(
      (iv) =>
        `📅 นัด: ${formatWhen(iv.startsAt, tz, t)}` +
        (iv.place ? ` · ${isUrl(iv.place) ? 'ออนไลน์' : iv.place}` : ''),
    );
  }

  return {
    ask,
    create,
    move,
    typedTime,
    askPlace,
    savePlace,
    confirmRemove,
    remove,
    list,
    setReminders,
    linesForJob,
  };
}
