import type { messagingApi } from '@line/bot-sdk';
import { describe, expect, it } from 'vitest';
import { LINK_PROVIDER } from '../src/jobs/repository.js';
import { decodePostback } from '../src/line/postback.js';
import { parseTitleInput } from '../src/line/tracking.js';
import { createFakeBot } from './fakes.js';

async function readyBot() {
  const bot = createFakeBot();
  await bot.follow();
  await bot.tap({ a: 'consent', v: 'accept' });
  await bot.say('Data Analyst');
  await bot.say('กรุงเทพฯ');
  await bot.tap({ a: 'wiz', v: 'any' });
  await bot.say('ข้าม');
  await bot.tap({ a: 'wiz', v: 'none' });
  await bot.tap({ a: 'wiz', v: 'save' });
  return bot;
}

const userId = (bot: ReturnType<typeof createFakeBot>) => bot.usersByLineId.get('U1')!.id;

function quickReplies(bot: ReturnType<typeof createFakeBot>) {
  const last = bot.lastReply().at(-1) as messagingApi.TextMessage;
  return (last.quickReply?.items ?? []).map((i) => {
    const a = i.action as messagingApi.PostbackAction;
    return { label: a.label, data: a.data ? decodePostback(a.data) : undefined };
  });
}

function bubbleOf(bot: ReturnType<typeof createFakeBot>) {
  const flex = bot.lastReply().find((m) => m.type === 'flex') as messagingApi.FlexMessage;
  const carousel = flex.contents as messagingApi.FlexCarousel;
  return JSON.stringify(carousel.contents[0]);
}

describe('adding a job by link', () => {
  it('saves a job from a page title and shows it as a card', async () => {
    const bot = await readyBot();
    bot.linkPreview.next = {
      title: 'Data Analyst',
      company: 'Acme Careers',
      location: 'Bangkok',
      department: null,
      workplace: null,
    };
    const reply = await bot.say(
      'ดูอันนี้ https://careers.acme.co.th/jobs/42?utm_source=line#apply',
    );
    expect(reply[0]).toContain('บันทึกงานจากลิงก์');
    expect(reply[1]).toBe('[flex]');
    expect(bot.previewLink).toHaveBeenCalledWith('https://careers.acme.co.th/jobs/42');

    const job = [...bot.jobRows.values()].find((j) => j.provider === LINK_PROVIDER)!;
    expect(job).toMatchObject({ title: 'Data Analyst', company: 'Acme Careers' });
    expect(bot.userJobRows.get(`${userId(bot)}:${job.id}`)?.status).toBe('saved');
    // Link jobs are private to whoever saved them: never in the shared feed.
    expect(await bot.tap({ a: 'list', s: 'saved', v: 'card', p: '1' })).toEqual([
      expect.stringContaining('1 งาน'),
      '[flex]',
    ]);
  });

  it('reuses a synced job when the link points at it, without fetching', async () => {
    const bot = await readyBot();
    const id = bot.addJob({
      title: 'Backend Engineer',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
    });
    await bot.say('https://boards.greenhouse.io/acme/jobs/1');
    expect(bot.previewLink).not.toHaveBeenCalled();
    expect(bot.userJobRows.get(`${userId(bot)}:${id}`)?.status).toBe('saved');
  });

  it('tells the user when the job is already in their list', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA', url: 'https://x.example/qa' });
    await bot.tap({ a: 'job', v: 'apply', j: id });
    const reply = await bot.say('https://x.example/qa');
    expect(reply).toHaveLength(1); // no card: it's a duplicate
    expect(reply[0]).toContain('ลิงก์นี้ซ้ำ');
    expect(reply[0]).toContain('ที่สมัครไว้');
    expect(reply[0]).toContain('ไม่ได้บันทึกซ้ำ');
    expect(bot.userJobRows.get(`${userId(bot)}:${id}`)?.status).toBe('applied');
  });

  it('reports a link the user already saved as a duplicate', async () => {
    const bot = await readyBot();
    await bot.say('https://x.example/1');
    const again = await bot.say('https://x.example/1?utm_source=line');
    expect(again).toHaveLength(1);
    expect(again[0]).toContain('ลิงก์นี้ซ้ำ');
    expect(again[0]).toContain('ที่เก็บไว้');
    expect([...bot.jobRows.values()].filter((j) => j.provider === LINK_PROVIDER)).toHaveLength(1);
  });

  it('asks for the title when the page gives none, and renames the job', async () => {
    const bot = await readyBot();
    const reply = await bot.say('https://jobs.example.com/p/9');
    expect(reply.at(-1)).toContain('พิมพ์ชื่อตำแหน่ง');
    const job = [...bot.jobRows.values()].find((j) => j.provider === LINK_PROVIDER)!;
    expect(job.title).toBe('งานจาก jobs.example.com');

    const named = await bot.say('Data Engineer @ SCB');
    expect(named[0]).toContain('Data Engineer @ SCB');
    expect(job).toMatchObject({ title: 'Data Engineer', company: 'SCB' });
    // The flow is over: the next message is handled normally.
    expect((await bot.say('งาน'))[0]).not.toContain('ตั้งชื่อ');
  });

  it('can skip naming', async () => {
    const bot = await readyBot();
    await bot.say('https://jobs.example.com/p/9');
    expect((await bot.tap({ a: 'title', v: 'skip' }))[0]).toContain('โอเค');
    expect(bot.sessionsByUser.size).toBe(0);
  });

  it('rejects links that are too long for LINE buttons', async () => {
    const bot = await readyBot();
    const reply = await bot.say(`https://x.example/${'a'.repeat(1100)}`);
    expect(reply[0]).toContain('ลิงก์นี้ใช้ไม่ได้');
    expect(bot.previewLink).not.toHaveBeenCalled();
  });
});

describe('notes', () => {
  it('records a note typed after tapping 📝 and lists it in the detail view', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'Data Analyst', company: 'Agoda' });
    expect((await bot.tap({ a: 'job', v: 'note', j: id }))[0]).toContain('พิมพ์โน้ต');

    const saved = await bot.say('HR ชื่อคุณเอ โทร 02-xxx');
    expect(saved[0]).toContain('จดแล้ว (งานนี้มี 1 โน้ต)');
    // Writing a note keeps the job in the user's list.
    expect(bot.userJobRows.get(`${userId(bot)}:${id}`)?.status).toBe('saved');

    const detail = await bot.tap({ a: 'job', v: 'detail', j: id });
    expect(detail[0]).toContain('HR ชื่อคุณเอ');
    expect(detail[0]).toContain('โน้ต 1 รายการ');
  });

  it('does not save keywords typed after cancelling', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    await bot.tap({ a: 'job', v: 'note', j: id });
    expect((await bot.say('ยกเลิก'))[0]).toContain('ยกเลิก');
    expect(bot.noteRows).toHaveLength(0);
  });

  it('treats a link typed during a note as the note itself', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    await bot.tap({ a: 'job', v: 'note', j: id });
    await bot.say('portfolio: https://my.site/cv');
    expect(bot.noteRows[0]?.body).toBe('portfolio: https://my.site/cv');
    expect(bot.previewLink).not.toHaveBeenCalled();
  });

  it('abandons the note when the user taps a menu', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    await bot.tap({ a: 'job', v: 'note', j: id });
    await bot.tap({ a: 'menu', m: 'help' });
    await bot.say('งาน');
    expect(bot.noteRows).toHaveLength(0);
  });

  it('shows the note count on saved cards', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    await bot.tap({ a: 'job', v: 'note', j: id });
    await bot.say('one');
    await bot.tap({ a: 'list', s: 'saved', v: 'card', p: '1' });
    expect(bubbleOf(bot)).toContain('📝 โน้ต (1)');
  });
});

describe('application stages', () => {
  it('marks applied jobs as stage "applied" and shows it on the card', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    await bot.tap({ a: 'job', v: 'apply', j: id });
    expect(bot.userJobRows.get(`${userId(bot)}:${id}`)?.stage).toBe('applied');
    await bot.tap({ a: 'list', s: 'applied', v: 'card', p: '1' });
    expect(bubbleOf(bot)).toContain('สถานะ: ✅ สมัครแล้ว');
    expect(bubbleOf(bot)).toContain('🔄 อัปเดตสถานะ');
  });

  it('offers every other stage and moves the application along', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    await bot.tap({ a: 'job', v: 'apply', j: id });
    await bot.tap({ a: 'job', v: 'stage', j: id });
    const options = quickReplies(bot);
    expect(options.map((o) => o.data?.v)).toEqual([
      'contacted',
      'interview',
      'waiting',
      'offer',
      'rejected',
    ]);

    const reply = await bot.tap(options[1]!.data!);
    expect(reply[0]).toContain('📅 นัดสัมภาษณ์');
    expect(bot.userJobRows.get(`${userId(bot)}:${id}`)?.stage).toBe('interview');
    // Re-tapping "applied" on the card must not reset the stage.
    await bot.tap({ a: 'job', v: 'apply', j: id });
    expect(bot.userJobRows.get(`${userId(bot)}:${id}`)?.stage).toBe('interview');
  });

  it('moving a saved job to a stage marks it applied', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    await bot.tap({ a: 'job', v: 'save', j: id });
    await bot.tap({ a: 'stage', v: 'contacted', j: id });
    expect(bot.userJobRows.get(`${userId(bot)}:${id}`)).toMatchObject({
      status: 'applied',
      stage: 'contacted',
    });
  });

  it('ignores unknown stages', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    expect((await bot.tap({ a: 'stage', v: 'hacked', j: id }))[0]).toContain('ไม่รู้จัก');
  });
});

describe('parseTitleInput', () => {
  it.each([
    ['Data Analyst @ SCB', { title: 'Data Analyst', company: 'SCB' }],
    ['Data Analyst at Agoda', { title: 'Data Analyst', company: 'Agoda' }],
    ['นักการตลาด บริษัท ABC', { title: 'นักการตลาด', company: 'ABC' }],
    ['Backend Developer', { title: 'Backend Developer' }],
  ])('%s', (input, expected) => {
    expect(parseTitleInput(input)).toEqual(expected);
  });
});
