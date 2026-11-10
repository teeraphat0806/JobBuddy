import { describe, expect, it } from 'vitest';
import { rankJobs, scoreJob, type MatchableJob } from '../src/jobs/match.js';
import type { PrefsInput } from '../src/prefs/types.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

let n = 0;
function job(partial: Partial<MatchableJob> & { title: string }): MatchableJob {
  return {
    id: `j${++n}`,
    company: 'Acme',
    location: 'Bangkok, Thailand',
    department: null,
    workplace: null,
    postedAt: new Date(NOW.getTime() - 30 * DAY),
    firstSeenAt: new Date(NOW.getTime() - 30 * DAY),
    ...partial,
  };
}

function prefs(partial: Partial<PrefsInput> = {}): PrefsInput {
  return {
    positions: ['Data Analyst'],
    locations: [],
    workMode: 'any',
    minSalary: null,
    excludedKeywords: [],
    ...partial,
  };
}

describe('scoreJob: role matching', () => {
  it('scores an exact title phrase highest', () => {
    expect(scoreJob(job({ title: 'Senior Data Analyst' }), prefs(), NOW)).toBe(100);
  });

  it('matches when all significant words appear in any order', () => {
    expect(scoreJob(job({ title: 'Analyst, Data & Insights' }), prefs(), NOW)).toBe(80);
  });

  it('does not match a different job that shares one word', () => {
    expect(scoreJob(job({ title: 'Data Engineer' }), prefs(), NOW)).toBeNull();
    expect(scoreJob(job({ title: 'Financial Analyst' }), prefs(), NOW)).toBeNull();
  });

  it('matches Thai role names to English titles (as synonym hits)', () => {
    const p = prefs({ positions: ['บัญชี'] });
    expect(scoreJob(job({ title: 'Accountant' }), p, NOW)).toBe(85);
    expect(scoreJob(job({ title: 'Accounts Payable Officer' }), p, NOW)).toBe(85);
    expect(scoreJob(job({ title: 'Key Account Manager' }), p, NOW)).toBeNull();
  });

  it('ranks what the user typed above synonym hits', () => {
    const exact = scoreJob(job({ title: 'Data Analyst' }), prefs(), NOW)!;
    const synonym = scoreJob(job({ title: 'Supply Analytics Intern' }), prefs(), NOW)!;
    expect(exact).toBeGreaterThan(synonym);
  });

  it('does not treat designers as marketing', () => {
    const p = prefs({ positions: ['การตลาด'] });
    expect(scoreJob(job({ title: 'Lead Brand Designer' }), p, NOW)).toBeNull();
    expect(scoreJob(job({ title: 'Brand Marketing Manager' }), p, NOW)).toBe(85);
  });

  it('uses the best of several positions', () => {
    const p = prefs({ positions: ['Marketing', 'HR'] });
    expect(scoreJob(job({ title: 'People Partner' }), p, NOW)).not.toBeNull();
    expect(scoreJob(job({ title: 'Brand Marketing Manager' }), p, NOW)).toBe(100);
  });
});

describe('scoreJob: filters', () => {
  it('honours Thai place names', () => {
    const p = prefs({ locations: ['กรุงเทพฯ'] });
    expect(scoreJob(job({ title: 'Data Analyst', location: 'Bangkok, Thailand' }), p, NOW)).toBe(
      100,
    );
    expect(
      scoreJob(job({ title: 'Data Analyst', location: 'Rayong, Thailand' }), p, NOW),
    ).toBeNull();
  });

  it('lets remote jobs through any location filter', () => {
    const p = prefs({ locations: ['เชียงใหม่'] });
    expect(scoreJob(job({ title: 'Data Analyst', workplace: 'remote' }), p, NOW)).toBe(100);
  });

  it('keeps country-only locations but ranks them lower', () => {
    const p = prefs({ locations: ['กรุงเทพฯ'] });
    expect(scoreJob(job({ title: 'Data Analyst', location: 'Thailand' }), p, NOW)).toBe(70);
  });

  it('applies work mode preferences', () => {
    const remote = prefs({ workMode: 'remote' });
    expect(scoreJob(job({ title: 'Data Analyst', workplace: 'onsite' }), remote, NOW)).toBeNull();
    expect(scoreJob(job({ title: 'Data Analyst', workplace: 'remote' }), remote, NOW)).toBe(100);
    expect(scoreJob(job({ title: 'Data Analyst', workplace: 'hybrid' }), remote, NOW)).toBe(70);
    // Unknown workplace on these boards is almost always an office job.
    expect(scoreJob(job({ title: 'Data Analyst', workplace: null }), remote, NOW)).toBeNull();
    const onsite = prefs({ workMode: 'onsite' });
    expect(scoreJob(job({ title: 'Data Analyst', workplace: 'remote' }), onsite, NOW)).toBeNull();
  });

  it('drops jobs containing excluded keywords (case-insensitive)', () => {
    const p = prefs({ positions: ['Sales'], excludedKeywords: ['insurance'] });
    expect(scoreJob(job({ title: 'Insurance Sales Agent' }), p, NOW)).toBeNull();
    expect(scoreJob(job({ title: 'Sales Executive' }), p, NOW)).not.toBeNull();
  });

  it('adds a bonus for recent postings', () => {
    const fresh = job({ title: 'Data Analyst', postedAt: new Date(NOW.getTime() - DAY) });
    expect(scoreJob(fresh, prefs(), NOW)).toBe(110);
  });
});

describe('rankJobs', () => {
  it('sorts best first, skips acted-on jobs and flags new ones', () => {
    const exact = job({ title: 'Data Analyst' });
    const partial = job({ title: 'Analyst - Data Platform' });
    const fresh = job({ title: 'Data Analyst II', postedAt: new Date(NOW.getTime() - DAY) });
    const hidden = job({ title: 'Data Analyst (hidden)' });
    const unrelated = job({ title: 'Chef' });

    const ranked = rankJobs(
      [partial, exact, unrelated, fresh, hidden],
      prefs(),
      new Set([hidden.id]),
      NOW,
    );
    expect(ranked.map((r) => r.job.id)).toEqual([fresh.id, exact.id, partial.id]);
    expect(ranked[0]!.isNew).toBe(true);
    expect(ranked[1]!.isNew).toBe(false);
  });
});
