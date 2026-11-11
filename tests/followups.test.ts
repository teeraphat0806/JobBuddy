import type { messagingApi } from '@line/bot-sdk';
import { describe, expect, it, vi } from 'vitest';
import { runDigest } from '../src/followups/digest.js';
import type { DigestRepository, FollowUpItem } from '../src/followups/repository.js';
import { digestMessages } from '../src/line/followups.js';
import { createFakeBot } from './fakes.js';
import { silentLogger } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

async function readyBot(clock: { t: Date }) {
  const bot = createFakeBot({ now: () => clock.t });
  await bot.follow();
  await bot.tap({ a: 'consent', v: 'accept' });
  await bot.tap({ a: 'wiz', v: 'cancel' });
  return bot;
}

describe('overview stats', () => {
  it('explains what to do when nothing is tracked yet', async () => {
    const bot = await readyBot({ t: new Date('2026-11-11T03:00:00Z') });
    const [reply] = await bot.say('สรุป');
    expect(reply).toContain('ยังไม่มีข้อมูล');
  });

  it('counts saved and applied jobs, stages, replies and long waits', async () => {
    const clock = { t: new Date('2026-10-01T03:00:00Z') };
    const bot = await readyBot(clock);
    const ids = ['A', 'B', 'C', 'D'].map((t) => bot.addJob({ title: `Job ${t}` }));
    const closed = bot.addJob({ title: 'Closed job', active: false });
    const open = bot.addJob({ title: 'Open job' });
    await bot.tap({ a: 'job', v: 'save', j: closed });
    await bot.tap({ a: 'job', v: 'save', j: open });
    for (const id of ids) await bot.tap({ a: 'job', v: 'apply', j: id });

    clock.t = new Date(clock.t.getTime() + 4 * DAY); // heard back from B after 4 days
    await bot.tap({ a: 'stage', v: 'contacted', j: ids[1]! });
    clock.t = new Date(clock.t.getTime() + 2 * DAY); // C turned down after 6 days
    await bot.tap({ a: 'stage', v: 'rejected', j: ids[2]! });
    clock.t = new Date(clock.t.getTime() + 20 * DAY); // A and D still waiting, 26 days in

    const [reply] = await bot.say('สรุป');
    expect(reply).toContain('⭐ เก็บไว้ 2 งาน (ปิดรับแล้ว 1)');
    expect(reply).toContain('📋 สมัครแล้ว 4 งาน');
    expect(reply).toContain('⏳ รอติดต่อกลับ 2 (นานกว่า 14 วัน 2)');
    expect(reply).toContain('📞 ติดต่อกลับแล้ว 1');
    expect(reply).toContain('🙏 ไม่ผ่าน 1');
    expect(reply).toContain('บริษัทติดต่อกลับ 2 จาก 4 งาน (50%)');
    expect(reply).toContain('รอเฉลี่ย 5 วัน');
    expect(reply).not.toContain('🎉');
  });
});

describe('follow-up actions', () => {
  it('drafts a follow-up in Thai and English, worded for the stage', async () => {
    const clock = { t: new Date('2026-11-01T03:00:00Z') };
    const bot = await readyBot(clock);
    const id = bot.addJob({ title: 'Data Analyst', company: 'Acme' });
    await bot.tap({ a: 'job', v: 'apply', j: id });
    clock.t = new Date(clock.t.getTime() + 8 * DAY);

    const reply = await bot.tap({ a: 'fu', v: 'draft', j: id });
    expect(reply).toHaveLength(3);
    expect(reply[0]).toContain('รอมา 8 วัน');
    expect(reply[1]).toContain('เรียน ฝ่ายบุคคล Acme');
    expect(reply[1]).toContain('ได้สมัครงานตำแหน่ง Data Analyst เมื่อวันที่ 1 พฤศจิกายน');
    expect(reply[2]).toContain('Dear Acme Hiring Team');
    expect(reply[2]).toContain('on 1 November');

    await bot.tap({ a: 'stage', v: 'waiting', j: id });
    const after = await bot.tap({ a: 'fu', v: 'draft', j: id });
    expect(after[1]).toContain('ขอบคุณสำหรับโอกาสในการสัมภาษณ์');
  });

  it('snoozes the next nudge by a week, only for applied jobs', async () => {
    const clock = { t: new Date('2026-11-11T03:00:00Z') };
    const bot = await readyBot(clock);
    const applied = bot.addJob({ title: 'Applied' });
    const saved = bot.addJob({ title: 'Saved' });
    await bot.tap({ a: 'job', v: 'apply', j: applied });
    await bot.tap({ a: 'job', v: 'save', j: saved });

    const [ok] = await bot.tap({ a: 'fu', v: 'snooze', j: applied });
    expect(ok).toContain('อีกครั้งใน 7 วัน');
    const uid = bot.usersByLineId.get('U1')!.id;
    expect(bot.snoozes.get(`${uid}:${applied}`)?.getTime()).toBe(clock.t.getTime() + 7 * DAY);

    const [no] = await bot.tap({ a: 'fu', v: 'snooze', j: saved });
    expect(no).toContain('ไม่ได้อยู่ใน 📋');
    const [noDraft] = await bot.tap({ a: 'fu', v: 'draft', j: saved });
    expect(noDraft).toContain('ไม่ได้อยู่ใน 📋');
  });

  it('turns the daily digest off and on with the reminder switch', async () => {
    const bot = await readyBot({ t: new Date('2026-11-11T03:00:00Z') });
    await bot.say('ปิดเตือน');
    expect(bot.usersByLineId.get('U1')).toMatchObject({
      notifyInterviewReminders: false,
      notifyFollowUps: false,
    });
    await bot.say('เปิดเตือน');
    expect(bot.usersByLineId.get('U1')?.notifyFollowUps).toBe(true);
  });
});

const item = (n: number): FollowUpItem => ({
  jobId: `j${n}`,
  title: `Job ${n}`,
  company: 'Acme',
  stage: 'applied',
  stageSince: new Date('2026-11-01T03:00:00Z'),
});

describe('digest messages', () => {
  const now = new Date('2026-11-11T03:00:00Z');

  it('shows at most 10 follow-ups, then closed jobs, ending with an off switch', () => {
    const msgs = digestMessages(
      Array.from({ length: 12 }, (_, i) => item(i)),
      [{ jobId: 'c', title: 'Gone job', company: 'Beta' }],
      now,
      'Asia/Bangkok',
    );
    expect(msgs.map((m) => m.type)).toEqual(['text', 'flex', 'text']);
    expect((msgs[0] as messagingApi.TextMessage).text).toContain('มี 12 งาน');
    expect((msgs[0] as messagingApi.TextMessage).text).toContain('อีก 2 งานอยู่ใน 📋');
    const carousel = (msgs[1] as messagingApi.FlexMessage).contents as messagingApi.FlexCarousel;
    expect(carousel.contents).toHaveLength(10);
    expect(JSON.stringify(carousel.contents[0])).toContain('รอติดต่อกลับ · 10 วัน');
    const last = msgs[2] as messagingApi.TextMessage;
    expect(last.text).toContain('ปิดรับสมัครแล้ว 1 งาน');
    expect(last.text).toContain('• Gone job · Beta');
    expect((last.quickReply?.items ?? []).map((i) => i.action?.label)).toEqual([
      '📋 ที่สมัครไว้',
      '⭐ ที่เก็บไว้',
      '🔕 ปิดการเตือน',
    ]);
  });

  it('sends only the closed-jobs note when nothing needs a follow-up', () => {
    const msgs = digestMessages(
      [],
      [{ jobId: 'c', title: 'Gone', company: 'B' }],
      now,
      'Asia/Bangkok',
    );
    expect(msgs.map((m) => m.type)).toEqual(['text']);
  });
});

describe('runDigest', () => {
  function repo(over: Partial<DigestRepository> = {}): DigestRepository {
    return {
      dueUsers: vi.fn(async () => [
        { userId: 'u1', lineUserId: 'L1' },
        { userId: 'u2', lineUserId: 'L2' },
        { userId: 'u3', lineUserId: 'L3' },
      ]),
      claimUser: vi.fn(async (id: string) => id !== 'u2'), // u2 already had today's digest
      claimFollowUps: vi.fn(async (id: string) => (id === 'u1' ? [item(1)] : [])),
      claimClosed: vi.fn(async () => []),
      snooze: vi.fn(async () => true),
      ...over,
    };
  }
  // 10:30 in Bangkok.
  const morning = new Date('2026-11-11T03:30:00Z');

  it('pushes one digest per user who has something, once their day is claimed', async () => {
    const digests = repo();
    const push = vi.fn(async (_to: string, _m: unknown[]) => {});
    const r = await runDigest(
      { digests, line: { push }, logger: silentLogger, timeZone: 'Asia/Bangkok' },
      morning,
    );
    expect(r).toEqual({ users: 3, sent: 1, failed: 0 });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toBe('L1');
    expect(digests.claimFollowUps).not.toHaveBeenCalledWith(
      'u2',
      expect.anything(),
      expect.anything(),
    );
  });

  it('stays quiet at night', async () => {
    const digests = repo();
    const push = vi.fn(async (_to: string, _m: unknown[]) => {});
    const night = new Date('2026-11-11T15:00:00Z'); // 22:00 in Bangkok
    await runDigest(
      { digests, line: { push }, logger: silentLogger, timeZone: 'Asia/Bangkok' },
      night,
    );
    expect(digests.dueUsers).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('counts a failed push and carries on', async () => {
    const digests = repo({ claimFollowUps: vi.fn(async () => [item(1)]) });
    const push = vi.fn(async (to: string) => {
      if (to === 'L1') throw new Error('quota');
    });
    const r = await runDigest(
      { digests, line: { push }, logger: silentLogger, timeZone: 'Asia/Bangkok' },
      morning,
    );
    expect(r).toEqual({ users: 3, sent: 1, failed: 1 });
  });
});
