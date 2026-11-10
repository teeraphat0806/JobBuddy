import type { messagingApi } from '@line/bot-sdk';
import { describe, expect, it } from 'vitest';
import { LINK_PROVIDER } from '../src/jobs/repository.js';
import { decodePostback } from '../src/line/postback.js';
import { MAX_LINKS_PER_MESSAGE } from '../src/line/tracking.js';
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

type Bot = Awaited<ReturnType<typeof readyBot>>;
const userId = (bot: Bot, line = 'U1') => bot.usersByLineId.get(line)!.id;

/** All postback payloads reachable from a Flex message (rows and buttons). */
function postbacks(message: unknown): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  JSON.stringify(message, (key, value) => {
    if (key === 'data' && typeof value === 'string') out.push(decodePostback(value));
    return value;
  });
  return out;
}

async function saveMany(bot: Bot, n: number) {
  for (let i = 0; i < n; i++) {
    const id = bot.addJob({ title: `Job ${i + 1}`, company: `Co ${i + 1}` });
    await bot.tap({ a: 'job', v: 'save', j: id });
  }
}

describe('many links in one message', () => {
  it('saves every link and summarises them', async () => {
    const bot = await readyBot();
    bot.linkPreview.next = {
      title: 'Analyst',
      company: 'Acme',
      location: '',
      department: null,
      workplace: null,
    };
    const reply = await bot.say(
      'สมัครพวกนี้\nhttps://a.example/1\nhttps://b.example/2 และ https://c.example/3',
    );
    expect(reply[0]).toContain('บันทึกจาก 3 ลิงก์');
    expect(reply[0]).toContain('เพิ่มใหม่ 3 งาน');
    expect(reply[1]).toBe('[flex]');
    const carousel = (bot.lastReply()[1] as messagingApi.FlexMessage)
      .contents as messagingApi.FlexCarousel;
    expect(carousel.contents).toHaveLength(3);
    const linkJobs = [...bot.jobRows.values()].filter((j) => j.provider === LINK_PROVIDER);
    expect(linkJobs).toHaveLength(3);
    for (const j of linkJobs) {
      expect(bot.userJobRows.get(`${userId(bot)}:${j.id}`)?.status).toBe('saved');
    }
  });

  it('counts duplicates, known jobs and broken links separately', async () => {
    const bot = await readyBot();
    const known = bot.addJob({ title: 'Known', url: 'https://known.example/job' });
    await bot.tap({ a: 'job', v: 'apply', j: known });
    const reply = await bot.say(
      `https://known.example/job https://new.example/1 https://new.example/1 https://x.example/${'a'.repeat(1100)}`,
    );
    expect(reply[0]).toContain('บันทึกจาก 3 ลิงก์'); // the duplicate is dropped up front
    expect(reply[0]).toContain('เพิ่มใหม่ 1 งาน');
    expect(reply[0]).toContain('มีอยู่แล้ว 1 งาน');
    expect(reply[0]).toContain('ใช้ไม่ได้ 1 ลิงก์');
    // An applied job is not downgraded by being sent again.
    expect(bot.userJobRows.get(`${userId(bot)}:${known}`)?.status).toBe('applied');
  });

  it(`stops at ${MAX_LINKS_PER_MESSAGE} links`, async () => {
    const bot = await readyBot();
    const links = Array.from({ length: 12 }, (_, i) => `https://x.example/${i}`).join(' ');
    const reply = await bot.say(links);
    expect(reply[0]).toContain(`บันทึกจาก ${MAX_LINKS_PER_MESSAGE} ลิงก์`);
    expect(reply[0]).toContain('ส่งที่เหลือมาอีกข้อความ');
    expect(bot.previewLink).toHaveBeenCalledTimes(MAX_LINKS_PER_MESSAGE);
  });

  it('points to renaming when titles could not be read', async () => {
    const bot = await readyBot();
    const reply = await bot.say('https://a.example/1 https://b.example/2');
    expect(reply[0]).toContain('อ่านชื่อไม่ได้');
    // No per-link question: the conversation isn't hijacked.
    expect(bot.sessionsByUser.size).toBe(0);
  });
});

describe('renaming link jobs', () => {
  it('renames from the detail view', async () => {
    const bot = await readyBot();
    await bot.say('https://a.example/1 https://b.example/2');
    const job = [...bot.jobRows.values()].find((j) => j.url === 'https://a.example/1')!;
    await bot.tap({ a: 'job', v: 'detail', j: job.id });
    const last = bot.lastReply()[0] as messagingApi.TextMessage;
    expect(JSON.stringify(last.quickReply)).toContain('แก้ชื่อ');

    expect((await bot.tap({ a: 'title', v: 'edit', j: job.id }))[0]).toContain('พิมพ์ชื่อใหม่');
    await bot.say('Data Engineer @ SCB');
    expect(job).toMatchObject({ title: 'Data Engineer', company: 'SCB' });
  });

  it('does not let one user rename a titled job that someone else saved', async () => {
    const bot = await readyBot();
    bot.linkPreview.next = {
      title: 'Analyst',
      company: 'Acme',
      location: '',
      department: null,
      workplace: null,
    };
    await bot.say('https://shared.example/1');
    const job = [...bot.jobRows.values()].find((j) => j.url === 'https://shared.example/1')!;
    await bot.follow('U2');
    await bot.tap({ a: 'consent', v: 'accept' }, 'U2');
    await bot.say('https://shared.example/1', 'U2');

    expect((await bot.tap({ a: 'title', v: 'edit', j: job.id }, 'U2'))[0]).toContain(
      'แก้ชื่อไม่ได้',
    );
    expect(job.title).toBe('Analyst');
  });

  it('never renames synced postings', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'Real Title' });
    await bot.tap({ a: 'job', v: 'save', j: id });
    expect((await bot.tap({ a: 'title', v: 'edit', j: id }))[0]).toContain('แก้ไม่ได้');
  });
});

describe('list view', () => {
  it('opens saved jobs as a compact list from the menu', async () => {
    const bot = await readyBot();
    await saveMany(bot, 3);
    expect(await bot.tap({ a: 'menu', m: 'saved' })).toEqual(['[flex]']);
    const msg = bot.lastReply()[0] as messagingApi.FlexMessage;
    expect(msg.altText).toBe('⭐ งานที่เก็บไว้ 3 งาน');
    const bubble = msg.contents as messagingApi.FlexBubble;
    expect(bubble.type).toBe('bubble');
    // Every row opens that job's details; newest first.
    const details = postbacks(bubble.body).filter((d) => d.v === 'detail');
    expect(details).toHaveLength(3);
    expect(JSON.stringify(bubble.body).indexOf('Job 3')).toBeLessThan(
      JSON.stringify(bubble.body).indexOf('Job 1'),
    );
    // Switch to cards; no paging needed for 3 jobs.
    expect(postbacks(bubble.footer)).toEqual([{ a: 'list', s: 'saved', v: 'card', p: '1' }]);
  });

  it('pages through long lists', async () => {
    const bot = await readyBot();
    await saveMany(bot, 20);
    await bot.tap({ a: 'menu', m: 'saved' });
    let bubble = (bot.lastReply()[0] as messagingApi.FlexMessage)
      .contents as messagingApi.FlexBubble;
    expect(JSON.stringify(bubble.header)).toContain('หน้า 1/2');
    expect(postbacks(bubble.body)).toHaveLength(15);
    expect(postbacks(bubble.footer)).toContainEqual({ a: 'list', s: 'saved', v: 'list', p: '2' });

    await bot.tap({ a: 'list', s: 'saved', v: 'list', p: '2' });
    bubble = (bot.lastReply()[0] as messagingApi.FlexMessage).contents as messagingApi.FlexBubble;
    expect(postbacks(bubble.body)).toHaveLength(5);
    expect(JSON.stringify(bubble.body)).toContain('"16."');
  });

  it('shows cards ten at a time with a "more" bubble', async () => {
    const bot = await readyBot();
    await saveMany(bot, 12);
    const reply = await bot.tap({ a: 'list', s: 'saved', v: 'card', p: '1' });
    expect(reply[0]).toContain('งานที่เก็บไว้ 12 งาน (1–10)');
    const carousel = (bot.lastReply()[1] as messagingApi.FlexMessage)
      .contents as messagingApi.FlexCarousel;
    expect(carousel.contents).toHaveLength(11);
    expect(postbacks(carousel.contents[10])).toEqual([
      { a: 'list', s: 'saved', v: 'card', p: '2' },
    ]);
  });

  it('clamps out-of-range pages', async () => {
    const bot = await readyBot();
    await saveMany(bot, 2);
    expect(await bot.tap({ a: 'list', s: 'saved', v: 'list', p: '99' })).toEqual(['[flex]']);
  });

  it('shows the application stage in the applied list', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'QA' });
    await bot.tap({ a: 'stage', v: 'interview', j: id });
    await bot.tap({ a: 'menu', m: 'applied' });
    expect(JSON.stringify(bot.lastReply()[0])).toContain('📅 นัดสัมภาษณ์');
  });
});
