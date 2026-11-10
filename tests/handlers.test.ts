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
    for (const m of ['feed', 'saved', 'applied', 'interviews']) {
      expect((await bot.tap({ a: 'menu', m }))[0]).toContain('กำลังพัฒนา');
    }
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
