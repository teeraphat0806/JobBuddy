import { describe, expect, it, vi } from 'vitest';
import {
  atsRefOf,
  canonicalUrl,
  createLinkPreviewer,
  decodeEntities,
  extractUrl,
  previewFromHtml,
} from '../src/links/preview.js';
import { assertFetchable, isPublicAddress } from '../src/links/safeFetch.js';

describe('extractUrl', () => {
  it('finds the first link and drops trailing punctuation', () => {
    expect(extractUrl('สมัครอันนี้ (https://a.co/jobs/1). ขอบคุณ')).toBe('https://a.co/jobs/1');
    expect(extractUrl('no link here')).toBeNull();
  });
});

describe('canonicalUrl', () => {
  it('removes fragments and tracking parameters but keeps the rest', () => {
    expect(canonicalUrl('https://a.co/j?id=5&utm_source=x&fbclid=y#top')).toBe(
      'https://a.co/j?id=5',
    );
  });
  it('rejects non-http and over-long links', () => {
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl(`https://a.co/${'x'.repeat(1000)}`)).toBeNull();
  });
});

describe('atsRefOf', () => {
  it.each([
    [
      'https://boards.greenhouse.io/agoda/jobs/123',
      { provider: 'greenhouse', board: 'agoda', id: '123' },
    ],
    [
      'https://job-boards.greenhouse.io/xendit/jobs/77?gh_src=a',
      { provider: 'greenhouse', board: 'xendit', id: '77' },
    ],
    [
      'https://boards.greenhouse.io/embed/job_app?for=okx&token=9',
      { provider: 'greenhouse', board: 'okx', id: '9' },
    ],
    [
      'https://jobs.lever.co/lalamove/0b6c1a2e-1111-2222-3333-444455556666/apply',
      { provider: 'lever', board: 'lalamove', id: '0b6c1a2e-1111-2222-3333-444455556666' },
    ],
    [
      'https://jobs.smartrecruiters.com/Grab/744000012345678-data-analyst',
      { provider: 'smartrecruiters', board: 'Grab', id: '744000012345678' },
    ],
  ])('%s', (url, ref) => {
    expect(atsRefOf(url)).toEqual(ref);
  });
  it('returns null for other sites', () => {
    expect(atsRefOf('https://www.jobsdb.com/th/job/123')).toBeNull();
  });
});

describe('previewFromHtml', () => {
  const page = (head: string) => ({
    url: 'https://x.co',
    html: `<html><head>${head}</head></html>`,
  });

  it('reads LinkedIn job titles', () => {
    const p = previewFromHtml(
      page(
        '<meta property="og:title" content="Acme hiring Data Analyst in Bangkok, Thailand | LinkedIn">',
      ),
    );
    expect(p).toMatchObject({
      title: 'Data Analyst',
      company: 'Acme',
      location: 'Bangkok, Thailand',
    });
  });

  it('strips the site name suffix and uses it as the company', () => {
    const p = previewFromHtml(
      page(
        `<meta content='Data Analyst &amp; BI | Acme Careers' property='og:title'>` +
          '<meta property="og:site_name" content="Acme Careers">',
      ),
    );
    expect(p).toMatchObject({ title: 'Data Analyst & BI', company: 'Acme Careers' });
  });

  it('does not treat job boards as the company, nor login walls as titles', () => {
    const p = previewFromHtml(
      page('<title>Sign In | LinkedIn</title><meta property="og:site_name" content="LinkedIn">'),
    );
    expect(p).toMatchObject({ title: null, company: null });
  });

  it('decodes entities', () => {
    expect(decodeEntities('A &#38; B &#x2013; C &nbsp;')).toBe('A & B – C  ');
  });
});

describe('createLinkPreviewer', () => {
  it('reads known job boards through their public API', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://boards-api.greenhouse.io/v1/boards/agoda/jobs/123');
      return new Response(
        JSON.stringify({
          title: 'Data Analyst',
          company_name: 'Agoda',
          location: { name: 'Bangkok' },
        }),
      );
    });
    const fetchHtml = vi.fn();
    const preview = await createLinkPreviewer({ fetchImpl, fetchHtml })(
      'https://boards.greenhouse.io/agoda/jobs/123',
    );
    expect(preview).toMatchObject({
      title: 'Data Analyst',
      company: 'Agoda',
      source: { provider: 'greenhouse', board: 'agoda', externalId: '123' },
    });
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('falls back to nothing when a page cannot be fetched', async () => {
    const preview = await createLinkPreviewer({
      fetchHtml: async () => {
        throw new Error('ECONNRESET');
      },
    })('https://x.co/job');
    expect(preview).toMatchObject({ url: 'https://x.co/job', title: null, company: null });
  });
});

describe('SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '100.100.1.1',
  ])('blocks %s', (ip) => expect(isPublicAddress(ip)).toBe(false));
  it('allows public addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700::1111')).toBe(true);
  });
  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://example.com:8080/',
    'ftp://example.com/',
    'http://user:pw@example.com/',
    'http://postgres.railway.internal/',
  ])('refuses %s', (url) => {
    expect(() => assertFetchable(new URL(url))).toThrow();
  });
});
