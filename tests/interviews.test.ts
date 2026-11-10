import type { messagingApi } from '@line/bot-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Interview, Job } from '../src/db/schema.js';
import type { InterviewRepository, ReminderCandidate } from '../src/interviews/repository.js';
import { runReminders } from '../src/interviews/reminders.js';
import { decodePostback } from '../src/line/postback.js';
import { createFakeBot } from './fakes.js';
import { silentLogger } from './helpers.js';

// Tuesday 10 Nov 2026, 10:00 in Bangkok.
const NOW = new Date('2026-11-10T03:00:00Z');
const bkk = (iso: string) => new Date(`${iso}+07:00`);

async function readyBot() {
  const bot = createFakeBot({ now: () => NOW });
  await bot.follow();
  await bot.tap({ a: 'consent', v: 'accept' });
  await bot.say('Data Analyst');
  await bot.say('กรุงเทพฯ');
  await bot.tap({ a: 'wiz', v: 'any' });
  await bot.say('ข้าม');
  await bot.tap({ a: 'wiz', v: 'none' });
  await bot.tap({ a: 'wiz', v: 'save' });
  const jobId = bot.addJob({ title: 'Data Analyst', company: 'Agoda' });
  await bot.tap({ a: 'job', v: 'apply', j: jobId });
  return { bot, jobId };
}

function firstAction(message: unknown): messagingApi.Action {
  const action = (message as messagingApi.TextMessage | undefined)?.quickReply?.items?.[0]?.action;
  if (!action) throw new Error('no quick reply');
  return action;
}

const userId = (bot: ReturnType<typeof createFakeBot>) => bot.usersByLineId.get('U1')!.id;
const onlyInterview = (bot: ReturnType<typeof createFakeBot>) => {
  const all = [...bot.interviewRows.values()];
  expect(all).toHaveLength(1);
  return all[0]!;
};

describe('booking an interview', () => {
  it('books from the date picker, moves the stage and explains reminders', async () => {
    const { bot, jobId } = await readyBot();
    const reply = await bot.pick({ a: 'iv', v: 'new', j: jobId }, '2026-11-13T14:00');
    expect(reply[0]).toContain('นัดสัมภาษณ์แล้ว');
    expect(reply[0]).toContain('ศ. 13 พ.ย. 14:00 (อีก 3 วัน)');
    expect(reply[0]).toContain('19:00');
    expect(onlyInterview(bot).startsAt).toEqual(bkk('2026-11-13T14:00'));
    expect(bot.userJobRows.get(`${userId(bot)}:${jobId}`)?.stage).toBe('interview');
  });

  it('refuses times in the past', async () => {
    const { bot, jobId } = await readyBot();
    const reply = await bot.pick({ a: 'iv', v: 'new', j: jobId }, '2026-11-10T09:00');
    expect(reply[0]).toContain('ผ่านไปแล้ว');
    expect(bot.interviewRows.size).toBe(0);
  });

  it('accepts a typed time after asking', async () => {
    const { bot, jobId } = await readyBot();
    const ask = await bot.tap({ a: 'iv', v: 'ask', j: jobId });
    expect(ask[0]).toContain('วันไหน เวลาเท่าไหร่');
    const picker = firstAction(bot.lastReply()[0]);
    expect(picker).toMatchObject({
      type: 'datetimepicker',
      mode: 'datetime',
      min: '2026-11-10T10:00',
    });

    expect((await bot.say('พรุ่งนี้'))[0]).toContain('กี่โมง');
    expect((await bot.say('พรุ่งนี้ บ่ายสอง'))[0]).toContain('นัดสัมภาษณ์แล้ว');
    expect(onlyInterview(bot).startsAt).toEqual(bkk('2026-11-11T14:00'));
  });

  it('lets other commands through when the reply is not a time', async () => {
    const { bot, jobId } = await readyBot();
    await bot.tap({ a: 'iv', v: 'ask', j: jobId });
    const reply = await bot.say('วิธีใช้');
    expect(reply[0]).toContain('วิธีใช้ JobBuddy');
    expect(bot.sessionsByUser.size).toBe(0);
  });

  it('offers the picker when the stage is set to interview', async () => {
    const { bot, jobId } = await readyBot();
    await bot.tap({ a: 'stage', v: 'interview', j: jobId });
    const first = firstAction(bot.lastReply()[0]);
    expect(first.type).toBe('datetimepicker');
    expect(decodePostback((first as messagingApi.DatetimePickerAction).data!)).toEqual({
      a: 'iv',
      v: 'new',
      j: jobId,
    });
  });

  it('does not downgrade an application that already got an offer', async () => {
    const { bot, jobId } = await readyBot();
    await bot.tap({ a: 'stage', v: 'offer', j: jobId });
    await bot.pick({ a: 'iv', v: 'new', j: jobId }, '2026-11-13T14:00');
    expect(bot.userJobRows.get(`${userId(bot)}:${jobId}`)?.stage).toBe('offer');
  });
});

describe('managing interviews', () => {
  async function booked() {
    const r = await readyBot();
    await r.bot.pick({ a: 'iv', v: 'new', j: r.jobId }, '2026-11-13T14:00');
    return { ...r, iv: onlyInterview(r.bot) };
  }

  it('lists upcoming interviews from the menu', async () => {
    const { bot } = await booked();
    const reply = await bot.tap({ a: 'menu', m: 'interviews' });
    expect(reply).toEqual([expect.stringContaining('1 นัด'), '[flex]']);
    expect(JSON.stringify(bot.lastReply()[1])).toContain('ศ. 13 พ.ย. 14:00');
  });

  it('explains how to add one when there are none', async () => {
    const { bot } = await readyBot();
    expect((await bot.say('นัด'))[0]).toContain('ยังไม่มีนัด');
  });

  it('records a place, and shows a join button for meeting links', async () => {
    const { bot, iv } = await booked();
    await bot.tap({ a: 'iv', v: 'place', i: iv.id });
    await bot.say('https://meet.google.com/abc-defg-hij');
    expect(iv.place).toBe('https://meet.google.com/abc-defg-hij');
    await bot.tap({ a: 'menu', m: 'interviews' });
    expect(JSON.stringify(bot.lastReply()[1])).toContain('เข้าห้องสัมภาษณ์');
  });

  it('reschedules and re-arms reminders', async () => {
    const { bot, iv } = await booked();
    iv.remindedEveningAt = NOW;
    const reply = await bot.pick({ a: 'iv', v: 'move', i: iv.id }, '2026-11-14T09:00');
    expect(reply[0]).toContain('เปลี่ยนเวลานัดแล้ว');
    expect(iv.startsAt).toEqual(bkk('2026-11-14T09:00'));
    expect(iv.remindedEveningAt).toBeNull();
  });

  it('cancels after confirmation', async () => {
    const { bot, iv } = await booked();
    expect((await bot.tap({ a: 'iv', v: 'del', i: iv.id }))[0]).toContain('ใช่ไหม');
    expect(bot.interviewRows.size).toBe(1);
    await bot.tap({ a: 'iv', v: 'delok', i: iv.id });
    expect(bot.interviewRows.size).toBe(0);
  });

  it("cannot touch another user's interview", async () => {
    const { bot, iv } = await booked();
    await bot.follow('U2');
    await bot.tap({ a: 'consent', v: 'accept' }, 'U2');
    await bot.tap({ a: 'iv', v: 'delok', i: iv.id }, 'U2');
    expect(bot.interviewRows.size).toBe(1);
  });

  it('shows the interview in the job detail view', async () => {
    const { bot, jobId } = await booked();
    expect((await bot.tap({ a: 'job', v: 'detail', j: jobId }))[0]).toContain(
      '📅 นัด: ศ. 13 พ.ย. 14:00',
    );
  });

  it('turns reminders off and on', async () => {
    const { bot } = await booked();
    await bot.say('ปิดเตือน');
    expect(bot.usersByLineId.get('U1')?.notifyInterviewReminders).toBe(false);
    await bot.say('เปิดเตือน');
    expect(bot.usersByLineId.get('U1')?.notifyInterviewReminders).toBe(true);
  });
});

describe('runReminders', () => {
  const job = { id: 'j1', title: 'Data Analyst', company: 'Agoda' } as Job;
  const interview = (over: Partial<Interview> = {}): Interview => ({
    id: 'iv1',
    userId: 'u1',
    jobId: 'j1',
    startsAt: bkk('2026-11-11T14:00'),
    place: 'https://zoom.us/j/1',
    scheduledAt: bkk('2026-11-01T10:00'),
    remindedEveningAt: null,
    remindedSoonAt: null,
    createdAt: bkk('2026-11-01T10:00'),
    ...over,
  });

  function repo(candidates: ReminderCandidate[], claimable = true) {
    return {
      reminderCandidates: vi.fn(async () => candidates),
      claimReminder: vi.fn(async () => claimable),
    } as unknown as InterviewRepository & {
      claimReminder: ReturnType<typeof vi.fn>;
    };
  }

  it('pushes the evening reminder once it is due', async () => {
    const interviews = repo([{ interview: interview(), job, lineUserId: 'U1' }]);
    const line = { push: vi.fn(async () => {}) };
    const at = bkk('2026-11-10T19:05');
    const result = await runReminders(
      { interviews, line, logger: silentLogger, timeZone: 'Asia/Bangkok' },
      at,
    );
    expect(result).toEqual({ checked: 1, sent: 1, failed: 0 });
    expect(interviews.claimReminder).toHaveBeenCalledWith('iv1', 'evening', at);
    const [to, messages] = line.push.mock.calls[0] as unknown as [
      string,
      messagingApi.TextMessage[],
    ];
    expect(to).toBe('U1');
    expect(messages[0]!.text).toContain('พรุ่งนี้มีสัมภาษณ์');
    expect(firstAction(messages[0])).toMatchObject({ type: 'uri' });
  });

  it('does not push when another run already claimed it', async () => {
    const interviews = repo([{ interview: interview(), job, lineUserId: 'U1' }], false);
    const line = { push: vi.fn(async () => {}) };
    await runReminders(
      { interviews, line, logger: silentLogger, timeZone: 'Asia/Bangkok' },
      bkk('2026-11-10T19:05'),
    );
    expect(line.push).not.toHaveBeenCalled();
  });

  it('counts failed pushes without throwing', async () => {
    const interviews = repo([{ interview: interview(), job, lineUserId: 'U1' }]);
    const line = {
      push: vi.fn(async () => {
        throw new Error('429');
      }),
    };
    const result = await runReminders(
      { interviews, line, logger: silentLogger, timeZone: 'Asia/Bangkok' },
      bkk('2026-11-11T12:30'),
    );
    expect(result).toEqual({ checked: 1, sent: 0, failed: 1 });
  });
});
