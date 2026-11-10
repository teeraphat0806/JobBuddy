import { describe, expect, it } from 'vitest';
import { createFakeBot } from './fakes.js';

async function consentedBot() {
  const bot = createFakeBot();
  await bot.follow();
  await bot.tap({ a: 'consent', v: 'accept' });
  return bot;
}

async function completeWizard(bot: ReturnType<typeof createFakeBot>) {
  await bot.say('Data Analyst, Business Analyst');
  await bot.say('กรุงเทพฯ');
  await bot.tap({ a: 'wiz', v: 'hybrid' });
  await bot.say('30k');
  await bot.tap({ a: 'wiz', v: 'none' });
  return bot.tap({ a: 'wiz', v: 'save' });
}

describe('follow and consent', () => {
  it('welcomes a new user and asks for PDPA consent', async () => {
    const bot = createFakeBot();
    const reply = await bot.follow();
    expect(reply[0]).toContain('สวัสดีคุณTon');
    expect(reply[1]).toContain('PDPA');
    expect(bot.usersByLineId.get('U1')?.displayName).toBe('Ton');
  });

  it('keeps asking for consent until accepted', async () => {
    const bot = createFakeBot();
    await bot.follow();
    expect((await bot.say('ตั้งค่า'))[0]).toContain('PDPA');
    expect((await bot.tap({ a: 'menu', m: 'feed' }))[0]).toContain('PDPA');
  });

  it('starts the preferences wizard right after consent', async () => {
    const bot = createFakeBot();
    await bot.follow();
    const reply = await bot.tap({ a: 'consent', v: 'accept' });
    expect(bot.usersByLineId.get('U1')?.pdpaConsentedAt).toBeInstanceOf(Date);
    expect(reply.join('\n')).toContain('1/5');
  });

  it('creates a user on first message even without a follow event', async () => {
    const bot = createFakeBot();
    const reply = await bot.say('สวัสดี', 'Unew');
    expect(bot.usersByLineId.has('Unew')).toBe(true);
    expect(reply[0]).toContain('PDPA');
  });

  it('welcomes back a returning user who already set preferences', async () => {
    const bot = await consentedBot();
    await completeWizard(bot);
    await bot.unfollow();
    const reply = await bot.follow();
    expect(reply[0]).toContain('ยินดีต้อนรับกลับมา');
    expect(reply[1]).toContain('Data Analyst');
  });
});

describe('preferences wizard', () => {
  it('saves preferences after all five steps and confirmation', async () => {
    const bot = await consentedBot();
    const reply = await completeWizard(bot);
    expect(reply[0]).toContain('บันทึกแล้ว');
    const user = bot.usersByLineId.get('U1')!;
    expect(bot.prefsByUser.get(user.id)).toEqual({
      positions: ['Data Analyst', 'Business Analyst'],
      locations: ['กรุงเทพฯ'],
      workMode: 'hybrid',
      minSalary: 30000,
      excludedKeywords: [],
    });
    expect(bot.sessionsByUser.has(user.id)).toBe(false);
  });

  it('re-asks the same step on invalid input', async () => {
    const bot = await consentedBot();
    await bot.say('Data Analyst');
    await bot.say('กรุงเทพฯ');
    await bot.tap({ a: 'wiz', v: 'any' });
    const reply = await bot.say('เยอะๆ');
    expect(reply[0]).toContain('⚠️');
    expect(reply[1]).toContain('4/5');
  });

  it('cancels when the user types ยกเลิก', async () => {
    const bot = await consentedBot();
    await bot.say('Data Analyst');
    const reply = await bot.say('ยกเลิก');
    expect(reply[0]).toContain('ยกเลิก');
    const user = bot.usersByLineId.get('U1')!;
    expect(bot.sessionsByUser.has(user.id)).toBe(false);
    expect(bot.prefsByUser.has(user.id)).toBe(false);
  });

  it('abandons the wizard when a menu button is tapped', async () => {
    const bot = await consentedBot();
    await bot.say('Data Analyst');
    const reply = await bot.tap({ a: 'menu', m: 'help' });
    expect(reply[0]).toContain('วิธีใช้');
    expect(bot.sessionsByUser.size).toBe(0);
  });

  it('tells the user when a wizard button is tapped after the session ended', async () => {
    const bot = await consentedBot();
    bot.sessionsByUser.clear(); // simulate expiry
    const reply = await bot.tap({ a: 'wiz', v: 'remote' });
    expect(reply[0]).toContain('หมดเวลา');
  });

  it('shows current preferences from the menu and lets the user edit them', async () => {
    const bot = await consentedBot();
    await completeWizard(bot);
    const shown = await bot.tap({ a: 'menu', m: 'prefs' });
    expect(shown[0]).toContain('Data Analyst');
    const edit = await bot.tap({ a: 'prefs', v: 'edit' });
    expect(edit.join('\n')).toContain('1/5');
  });
});

describe('menu and commands', () => {
  it('answers not-yet-built menu items with a coming-soon message', async () => {
    const bot = await consentedBot();
    expect((await bot.tap({ a: 'menu', m: 'interviews' }))[0]).toContain('กำลังพัฒนา');
  });

  it('replies to unknown text and stickers with guidance', async () => {
    const bot = await consentedBot();
    await bot.say('ยกเลิก');
    expect((await bot.say('อะไรนะ'))[0]).toContain('ยังไม่เข้าใจ');
    expect((await bot.sticker())[0]).toContain('ยังไม่เข้าใจ');
  });

  it('never uses push (quota) for replies', async () => {
    const bot = await consentedBot();
    await completeWizard(bot);
    await bot.tap({ a: 'menu', m: 'feed' });
    expect(bot.line.push).not.toHaveBeenCalled();
  });
});

describe('delete my data', () => {
  it('asks for confirmation, then deletes everything', async () => {
    const bot = await consentedBot();
    await completeWizard(bot);
    expect((await bot.say('ลบข้อมูลของฉัน'))[0]).toContain('ลบข้อมูลทั้งหมด');
    const reply = await bot.tap({ a: 'delete', v: 'confirm' });
    expect(reply[0]).toContain('เรียบร้อย');
    expect(bot.usersByLineId.has('U1')).toBe(false);
    expect(bot.prefsByUser.size).toBe(0);
  });

  it('keeps data when the user declines', async () => {
    const bot = await consentedBot();
    await bot.say('ลบข้อมูลของฉัน');
    await bot.tap({ a: 'delete', v: 'cancel' });
    expect(bot.usersByLineId.has('U1')).toBe(true);
  });
});

describe('robustness', () => {
  it('still saves the user when the profile lookup fails', async () => {
    const bot = createFakeBot();
    bot.line.getProfile.mockRejectedValueOnce(new Error('403'));
    const reply = await bot.follow();
    expect(bot.usersByLineId.has('U1')).toBe(true);
    expect(reply[0]).toContain('สวัสดีคุณ');
  });

  it('marks the user unfollowed without replying', async () => {
    const bot = createFakeBot();
    await bot.follow();
    const replies = bot.line.reply.mock.calls.length;
    await bot.unfollow();
    expect(bot.usersByLineId.get('U1')?.status).toBe('unfollowed');
    expect(bot.line.reply.mock.calls.length).toBe(replies);
  });

  it('keeps processing other events when one fails', async () => {
    const bot = createFakeBot();
    const failing = bot.users.upsertOnFollow;
    bot.users.upsertOnFollow = async () => {
      throw new Error('db down');
    };
    await bot.follow('Ua');
    bot.users.upsertOnFollow = failing;
    expect(await bot.say('สวัสดี', 'Ub')).not.toHaveLength(0);
  });

  it('never replies with more than 5 messages', async () => {
    const bot = await consentedBot();
    await completeWizard(bot);
    await bot.unfollow();
    await bot.follow();
    expect(bot.lastReply().length).toBeLessThanOrEqual(5);
  });
});

describe('job feed', () => {
  async function botWithJobs() {
    const bot = await consentedBot();
    await completeWizard(bot); // Data Analyst / Business Analyst, กรุงเทพฯ, hybrid
    const ids = {
      exact: bot.addJob({ title: 'Data Analyst', company: 'Agoda' }),
      ba: bot.addJob({ title: 'Business Analyst', company: 'Grab' }),
      chef: bot.addJob({ title: 'Chef' }),
      rayong: bot.addJob({ title: 'Data Analyst', location: 'Rayong, Thailand' }),
    };
    return { bot, ids };
  }

  it('asks for preferences first when none are set', async () => {
    const bot = await consentedBot();
    await bot.say('ยกเลิก');
    const reply = await bot.tap({ a: 'menu', m: 'feed' });
    expect(reply[0]).toContain('อยากได้งานแบบไหน');
    expect(reply.join('\n')).toContain('1/5');
  });

  it('tells the user when no jobs have been collected yet', async () => {
    const bot = await consentedBot();
    await completeWizard(bot);
    expect((await bot.tap({ a: 'menu', m: 'feed' }))[0]).toContain('กำลังรวบรวม');
  });

  it('shows matching jobs as a carousel, filtered by role and location', async () => {
    const { bot } = await botWithJobs();
    const reply = await bot.tap({ a: 'menu', m: 'feed' });
    expect(reply[0]).toContain('เจอ 2 งาน');
    expect(reply[1]).toBe('[flex]');
    const flex = JSON.stringify(bot.lastReply()[1]);
    expect(flex).toContain('Data Analyst');
    expect(flex).toContain('Business Analyst');
    expect(flex).not.toContain('Chef');
    expect(flex).not.toContain('Rayong');
  });

  it('also opens the feed from text and from the button after saving preferences', async () => {
    const { bot } = await botWithJobs();
    expect((await bot.say('หางาน'))[0]).toContain('เจอ 2 งาน');
    expect((await bot.tap({ a: 'feed', p: '1' }))[0]).toContain('เจอ 2 งาน');
  });

  it('pages through results 5 at a time', async () => {
    const bot = await consentedBot();
    await completeWizard(bot);
    for (let i = 0; i < 7; i++) bot.addJob({ title: `Data Analyst ${i}` });
    await bot.tap({ a: 'menu', m: 'feed' });
    expect(JSON.stringify(bot.lastReply()[1])).toContain('ดูเพิ่ม');
    const page2 = await bot.tap({ a: 'feed', p: '2' });
    expect(page2[0]).toContain('งานที่ 6–7 จาก 7');
    expect(JSON.stringify(bot.lastReply()[1])).not.toContain('ดูเพิ่ม');
  });

  it('saves a job, lists it, and keeps it out of the feed', async () => {
    const { bot, ids } = await botWithJobs();
    expect((await bot.tap({ a: 'job', v: 'save', j: ids.exact }))[0]).toContain('เก็บไว้แล้ว');
    expect((await bot.tap({ a: 'menu', m: 'saved' }))[0]).toContain('งานที่เก็บไว้ 1 งาน');
    expect((await bot.tap({ a: 'menu', m: 'feed' }))[0]).toContain('เจอ 1 งาน');
  });

  it('records applied jobs and does not downgrade them to saved', async () => {
    const { bot, ids } = await botWithJobs();
    await bot.tap({ a: 'job', v: 'apply', j: ids.ba });
    expect((await bot.tap({ a: 'job', v: 'save', j: ids.ba }))[0]).toContain('สมัครไปแล้ว');
    expect((await bot.tap({ a: 'menu', m: 'applied' }))[0]).toContain('งานที่สมัครไว้ 1 งาน');
    expect((await bot.tap({ a: 'menu', m: 'saved' }))[0]).toContain('ยังไม่มีงาน');
  });

  it('hides a job from the feed and can undo it', async () => {
    const { bot, ids } = await botWithJobs();
    await bot.tap({ a: 'job', v: 'hide', j: ids.exact });
    expect((await bot.tap({ a: 'menu', m: 'feed' }))[0]).toContain('เจอ 1 งาน');
    await bot.tap({ a: 'job', v: 'unhide', j: ids.exact });
    expect((await bot.tap({ a: 'menu', m: 'feed' }))[0]).toContain('เจอ 2 งาน');
  });

  it('moves a saved job to applied from the saved list', async () => {
    const { bot, ids } = await botWithJobs();
    await bot.tap({ a: 'job', v: 'save', j: ids.exact });
    await bot.tap({ a: 'job', v: 'apply', j: ids.exact });
    expect((await bot.tap({ a: 'menu', m: 'saved' }))[0]).toContain('ยังไม่มีงาน');
    expect((await bot.tap({ a: 'menu', m: 'applied' }))[0]).toContain('1 งาน');
  });

  it('suggests editing preferences when nothing matches', async () => {
    const bot = await consentedBot();
    await completeWizard(bot);
    bot.addJob({ title: 'Chef' });
    expect((await bot.tap({ a: 'menu', m: 'feed' }))[0]).toContain('ยังไม่เจองาน');
  });

  it('handles a job that no longer exists', async () => {
    const { bot } = await botWithJobs();
    const reply = await bot.tap({ a: 'job', v: 'save', j: '00000000-0000-0000-0000-000000000000' });
    expect(reply[0]).toContain('ไม่พบงานนี้');
  });

  it('includes the add-friend link in shared jobs', async () => {
    const { bot } = await botWithJobs();
    await bot.tap({ a: 'menu', m: 'feed' });
    expect(JSON.stringify(bot.lastReply()[1])).toContain(
      encodeURIComponent('https://line.me/R/ti/p/%40jobbuddy'),
    );
  });
});
