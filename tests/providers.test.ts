import { describe, expect, it, vi } from 'vitest';
import {
  fetchGreenhouse,
  fetchLever,
  fetchSmartRecruiters,
  type Fetch,
} from '../src/jobs/providers.js';
import { runJobSync } from '../src/jobs/sync.js';
import type { JobRepository } from '../src/jobs/repository.js';
import { silentLogger } from './helpers.js';

function fakeFetch(routes: Record<string, unknown>): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as Fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

describe('fetchGreenhouse', () => {
  it('keeps Thai postings only and normalises fields', async () => {
    const f = fakeFetch({
      'boards/acme/jobs': {
        jobs: [
          {
            id: 1,
            title: ' Data Analyst ',
            absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
            location: { name: 'Bangkok, Thailand' },
            company_name: 'Acme Corp',
            first_published: '2026-11-01T00:00:00Z',
          },
          {
            id: 2,
            title: 'Engineer',
            absolute_url: 'https://x/2',
            location: { name: 'Singapore' },
          },
          {
            id: 3,
            title: 'Remote PM',
            absolute_url: 'https://x/3',
            location: { name: 'Remote - Thailand' },
          },
        ],
      },
    });
    const jobs = await fetchGreenhouse(
      { provider: 'greenhouse', board: 'acme', company: 'Acme' },
      f,
    );
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '1',
      title: 'Data Analyst',
      company: 'Acme Corp',
      location: 'Bangkok, Thailand',
      workplace: null,
      postedAt: new Date('2026-11-01T00:00:00Z'),
    });
    expect(jobs[1]).toMatchObject({ externalId: '3', workplace: 'remote' });
  });
});

describe('fetchLever', () => {
  it('uses country code and workplaceType', async () => {
    const f = fakeFetch({
      'postings/acme': [
        {
          id: 'a',
          text: 'Accounting Associate',
          hostedUrl: 'https://jobs.lever.co/acme/a',
          country: 'TH',
          workplaceType: 'onsite',
          createdAt: 1793695454456,
          categories: { location: 'Bangkok', allLocations: ['Bangkok'], department: 'Finance' },
        },
        {
          id: 'b',
          text: 'Driver',
          hostedUrl: 'https://x/b',
          country: 'VN',
          categories: { location: 'Hanoi' },
        },
      ],
    });
    const jobs = await fetchLever({ provider: 'lever', board: 'acme', company: 'Acme' }, f);
    expect(jobs).toEqual([
      expect.objectContaining({
        externalId: 'a',
        company: 'Acme',
        department: 'Finance',
        workplace: 'onsite',
        location: 'Bangkok',
      }),
    ]);
  });
});

describe('fetchSmartRecruiters', () => {
  it('pages through results and builds public URLs', async () => {
    const posting = (i: number) => ({
      id: String(i),
      name: `Job ${i}`,
      company: { name: 'Bosch' },
      releasedDate: '2026-11-06T05:55:39.512Z',
      location: {
        city: 'Bangkok',
        country: 'th',
        fullLocation: 'Bangkok, , Thailand',
        remote: false,
        hybrid: i % 2 === 0,
      },
      function: { label: 'Engineering' },
    });
    const f = fakeFetch({
      'offset=0': { totalFound: 150, content: Array.from({ length: 100 }, (_, i) => posting(i)) },
      'offset=100': {
        totalFound: 150,
        content: Array.from({ length: 50 }, (_, i) => posting(100 + i)),
      },
    });
    const jobs = await fetchSmartRecruiters(
      { provider: 'smartrecruiters', board: 'BoschGroup', company: 'Bosch' },
      f,
    );
    expect(jobs).toHaveLength(150);
    expect(f.calls).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      location: 'Bangkok, Thailand',
      url: 'https://jobs.smartrecruiters.com/BoschGroup/0',
      workplace: 'hybrid',
      department: 'Engineering',
    });
    expect(jobs[1]!.workplace).toBe('onsite');
  });
});

describe('runJobSync', () => {
  function repo() {
    return {
      upsertListings: vi.fn(async () => {}),
      deactivateMissing: vi.fn(async () => 2),
      listActive: vi.fn(async () => []),
      getById: vi.fn(async () => undefined),
      findByUrl: vi.fn(async () => undefined),
      findBySource: vi.fn(async () => undefined),
      createLinkJob: vi.fn(async () => {
        throw new Error('unused');
      }),
      rename: vi.fn(async () => {}),
      lastSyncedAt: vi.fn(async () => null),
    } satisfies JobRepository;
  }

  it('upserts and deactivates per source, but never deactivates a source that failed', async () => {
    const r = repo();
    const f = fakeFetch({
      'boards/good/jobs': {
        jobs: [{ id: 1, title: 'A', absolute_url: 'https://x/1', location: { name: 'Bangkok' } }],
      },
    });
    const summary = await runJobSync(
      r,
      [
        { provider: 'greenhouse', board: 'good', company: 'Good' },
        { provider: 'greenhouse', board: 'broken', company: 'Broken' },
      ],
      silentLogger,
      { fetchImpl: f },
    );
    expect(summary).toEqual({
      sources: 2,
      failed: ['greenhouse/broken'],
      listings: 1,
      deactivated: 2,
    });
    expect(r.deactivateMissing).toHaveBeenCalledTimes(1);
    expect(r.deactivateMissing).toHaveBeenCalledWith('greenhouse', 'good', expect.any(Date));
  });
});
