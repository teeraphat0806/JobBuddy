import { describe, expect, it, vi } from 'vitest';
import {
  atsRefOf,
  canonicalUrl,
  createLinkPreviewer,
  decodeEntities,
  extractAllUrls,
  extractUrl,
  looksUnsplit,
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
  it('recognises Workable postings', () => {
    expect(atsRefOf('https://apply.workable.com/2c2p/j/ABC123/')).toEqual({
      provider: 'workable',
      board: '2c2p',
      id: 'ABC123',
    });
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

  it('reads JSON-LD JobPosting on any site', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage' },
        {
          '@type': 'JobPosting',
          title: 'Data Engineer ',
          hiringOrganization: { '@type': 'Organization', name: 'Acme Co., Ltd.' },
          jobLocation: { address: { addressLocality: 'Bangkok', addressRegion: 'Bangkok' } },
        },
      ],
    });
    const p = previewFromHtml(
      page(`<title>Careers</title><script type="application/ld+json">${ld}</script>`),
    );
    expect(p).toMatchObject({ title: 'Data Engineer', company: 'Acme Co., Ltd.' });
    expect(p.location).toContain('Bangkok');
  });

  it('decodes entities', () => {
    expect(decodeEntities('A &#38; B &#x2013; C &nbsp;')).toBe('A & B – C  ');
  });
});

describe('Thai job boards', () => {
  const at = (url: string, head: string, body = '') => ({
    url,
    html: `<html><head>${head}</head><body>${body}</body></html>`,
  });

  it('JobThai: reads position and company from the description', () => {
    const p = previewFromHtml(
      at(
        'https://www.jobthai.com/th/company/job/1234567',
        '<title>งาน หางาน สมัครงาน บริษัท เอบีซี จำกัด | เจ้าหน้าที่บัญชี - JobThai</title>' +
          '<meta name="description" content="งาน บริษัท เอบีซี จำกัด ตำแหน่งงาน เจ้าหน้าที่บัญชี">',
      ),
    );
    expect(p).toMatchObject({ title: 'เจ้าหน้าที่บัญชี', company: 'บริษัท เอบีซี จำกัด' });
  });

  it('JobThai: falls back to either title layout', () => {
    expect(
      previewFromHtml(
        at(
          'https://www.jobthai.com/th/company/job/1',
          '<title>งาน หางาน สมัครงาน บริษัท เอบีซี จำกัด | Data Analyst - JobThai</title>',
        ),
      ),
    ).toMatchObject({ title: 'Data Analyst', company: 'บริษัท เอบีซี จำกัด' });
    expect(
      previewFromHtml(
        at(
          'https://www.jobthai.com/th/job/2',
          '<title>Data Analyst | บริษัท เอบีซี จำกัด งาน หางาน สมัครงาน - JobThai</title>',
        ),
      ),
    ).toMatchObject({ title: 'Data Analyst', company: 'บริษัท เอบีซี จำกัด' });
  });

  it("JobThai: the site's slogan is not a job title", () => {
    const p = previewFromHtml(
      at(
        'https://www.jobthai.com/th/jobs',
        '<title>JobThai - งาน หางาน สมัครงาน หาคน กว่า 200 อาชีพ อัปเดตทุกวัน จากบริษัทชั้นนำ</title>' +
          '<meta property="og:site_name" content="JobThai">',
      ),
    );
    expect(p).toMatchObject({ title: null, company: null });
  });

  it('JobsDB: reads the advertiser and the job title', () => {
    const p = previewFromHtml(
      at(
        'https://th.jobsdb.com/job/80000000',
        '<meta property="og:title" content="Sales Executive Job in Bang Na, Bangkok - Jobsdb">' +
          '<meta property="og:site_name" content="Jobsdb Thailand">',
        '<h1 data-automation="job-detail-title" class="x"><span>Sales Executive</span></h1>' +
          '<span data-automation="advertiser-name" class="y">Maison Royal Co., Ltd.</span>',
      ),
    );
    expect(p).toMatchObject({ title: 'Sales Executive', company: 'Maison Royal Co., Ltd.' });
    expect(p.location).toContain('Bangkok');
  });

  it('JobsDB: uses companyName and og:title when the markup differs', () => {
    const p = previewFromHtml(
      at(
        'https://th.jobsdb.com/job/1',
        '<meta property="og:title" content="QA Engineer Job in Bangkok - Jobsdb">',
        '<script>window.x={"companyName":"Acme \\"Thai\\" Co."}</script>',
      ),
    );
    expect(p).toMatchObject({ title: 'QA Engineer', company: 'Acme "Thai" Co.' });
  });

  it('JobBKK: reads JSON-LD even with raw newlines inside strings', () => {
    const ld =
      '{"@context":"https://schema.org","@type":"JobPosting","title":"พนักงานขาย ",' +
      '"description":"line one\nline two","hiringOrganization":{"@type":"Organization","name":"บริษัท ดีดี จำกัด"}}';
    const p = previewFromHtml(
      at(
        'https://www.jobbkk.com/jobs/detailurgent/1/2',
        '<meta property="og:site_name" content="JOBBKK.COM">' +
          `<script type="application/ld+json">${ld}</script>`,
      ),
    );
    expect(p).toMatchObject({ title: 'พนักงานขาย', company: 'บริษัท ดีดี จำกัด' });
  });

  it('JobBKK: falls back to the title', () => {
    const p = previewFromHtml(
      at(
        'https://www.jobbkk.com/jobs/detailurgent/1/2',
        '<meta property="og:title" content="พนักงานขาย | บริษัท ดีดี จำกัด งาน หางาน สมัครงาน - jobbkk.com">',
      ),
    );
    expect(p).toMatchObject({ title: 'พนักงานขาย', company: 'บริษัท ดีดี จำกัด' });
  });

  it('spots link jobs saved with a whole board title', () => {
    const board = 'jobthai.com';
    expect(
      looksUnsplit({
        board,
        company: board,
        title: 'JobThai - งาน หางาน สมัครงาน หาคน กว่า 200 อาชีพ',
      }),
    ).toBe(true);
    expect(looksUnsplit({ board, company: 'บริษัท เอบีซี จำกัด', title: 'Data Analyst' })).toBe(
      false,
    );
    expect(looksUnsplit({ board: 'acme.com', company: 'acme.com', title: 'x' })).toBe(false);
  });
});

describe('extractAllUrls', () => {
  it('keeps repeats so they can be reported', () => {
    expect(extractAllUrls('https://a.co/1 https://a.co/1, https://b.co')).toEqual([
      'https://a.co/1',
      'https://a.co/1',
      'https://b.co',
    ]);
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
