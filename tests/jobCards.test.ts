import { describe, expect, it } from 'vitest';
import { jobBubble, jobCarousel, shareUrl, type CardJob } from '../src/line/jobCards.js';

const job: CardJob = {
  id: '6f1c2b0e-9a1d-4f2e-8a7b-1c2d3e4f5a6b',
  title: 'Senior Data Analyst',
  company: 'Agoda',
  location: 'Bangkok, Thailand',
  department: 'Data',
  workplace: 'hybrid',
  url: 'https://job-boards.greenhouse.io/agoda/jobs/8184766',
  active: true,
};

describe('shareUrl', () => {
  it('pre-fills a LINE share with the job and an add-friend link', () => {
    const url = shareUrl(job, 'https://line.me/R/ti/p/%40jobbuddy');
    expect(url.startsWith('https://line.me/R/share?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]!);
    expect(text).toContain('Senior Data Analyst');
    expect(text).toContain(job.url);
    expect(text).toContain('https://line.me/R/ti/p/%40jobbuddy');
  });

  it('stays within LINE’s 1000-character URI limit even for long Thai text', () => {
    const long = {
      ...job,
      title: 'ตำแหน่งงานที่มีชื่อยาวมากๆ '.repeat(10),
      location: 'กรุงเทพมหานคร '.repeat(5),
    };
    const url = shareUrl(long, 'https://line.me/R/ti/p/%40jobbuddy');
    expect(url.length).toBeLessThanOrEqual(1000);
    expect(decodeURIComponent(url.split('text=')[1]!)).toContain(job.url);
  });
});

describe('job cards', () => {
  const postbacks = (b: ReturnType<typeof jobBubble>) =>
    JSON.stringify(b.footer).match(/"data":"[^"]+"/g) ?? [];

  it('feed cards offer save, applied, hide and share', () => {
    const s = JSON.stringify(jobBubble(job, 'feed', { isNew: true }));
    for (const label of [
      'ดูรายละเอียด',
      '⭐ เก็บไว้',
      '✅ สมัครแล้ว',
      '❌ ไม่สนใจ',
      '📤 แชร์',
      '🆕 ใหม่',
      'Hybrid',
    ]) {
      expect(s).toContain(label);
    }
  });

  it('keeps postback data within 300 characters', () => {
    for (const d of postbacks(jobBubble(job, 'feed'))) expect(d.length).toBeLessThanOrEqual(300);
  });

  it('marks closed postings', () => {
    expect(JSON.stringify(jobBubble({ ...job, active: false }, 'saved'))).toContain(
      'ปิดรับสมัครแล้ว',
    );
  });

  it('caps a carousel at 12 bubbles including the "more" bubble', () => {
    const items = Array.from({ length: 20 }, () => ({ job }));
    const msg = jobCarousel(items, 'feed', { altText: 'x', more: { a: 'feed', p: '2' } }) as {
      contents: { contents: unknown[] };
    };
    expect(msg.contents.contents).toHaveLength(12);
    expect(JSON.stringify(msg.contents.contents[11])).toContain('ดูเพิ่ม');
  });
});
