import { describe, expect, it, vi } from 'vitest';
import { LINK_PROVIDER } from '../src/jobs/repository.js';
import type { LinkPreview } from '../src/links/preview.js';
import { refreshLinkTitles } from '../src/links/refreshTitles.js';
import { createFakeBot } from './fakes.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('refreshLinkTitles', () => {
  it('splits old JobThai titles once, and leaves good ones alone', async () => {
    const bot = createFakeBot();
    const link = (title: string, company: string, url: string) =>
      bot.addJob({ provider: LINK_PROVIDER, board: 'jobthai.com', title, company, url });
    const bad = link(
      'JobThai - งาน หางาน สมัครงาน หาคน กว่า 200 อาชีพ',
      'jobthai.com',
      'https://www.jobthai.com/th/company/job/1',
    );
    const gone = link(
      'JobThai - งาน หางาน สมัครงาน หาคน กว่า 200 อาชีพ',
      'jobthai.com',
      'https://www.jobthai.com/th/company/job/2',
    );
    const good = link('Data Analyst', 'บริษัท เอบีซี จำกัด', 'https://www.jobthai.com/th/job/3');

    const previewLink = vi.fn(async (url: string): Promise<LinkPreview> => ({
      url,
      title: url.endsWith('/1') ? 'เจ้าหน้าที่บัญชี' : null,
      company: url.endsWith('/1') ? 'บริษัท เอบีซี จำกัด' : null,
      location: '',
      department: null,
      workplace: null,
    }));
    const deps = { jobs: bot.jobs, previewLink, logger };

    expect(await refreshLinkTitles(deps, { delayMs: 0 })).toEqual({ checked: 2, renamed: 2 });
    expect(bot.jobRows.get(bad)).toMatchObject({
      title: 'เจ้าหน้าที่บัญชี',
      company: 'บริษัท เอบีซี จำกัด',
    });
    // Nothing readable: falls back to the placeholder, which the user may rename.
    expect(bot.jobRows.get(gone)?.title).toBe('งานจาก jobthai.com');
    expect(bot.jobRows.get(good)?.title).toBe('Data Analyst');
    expect(previewLink).not.toHaveBeenCalledWith('https://www.jobthai.com/th/job/3');

    // Idempotent: a second run has nothing to do.
    previewLink.mockClear();
    expect(await refreshLinkTitles(deps, { delayMs: 0 })).toEqual({ checked: 0, renamed: 0 });
    expect(previewLink).not.toHaveBeenCalled();
  });
});
