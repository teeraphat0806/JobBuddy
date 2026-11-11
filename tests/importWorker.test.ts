import { describe, expect, it, vi } from 'vitest';
import type { ClaimedImport, LinkImportRepository } from '../src/links/importRepository.js';
import { createLinkImportWorker } from '../src/links/importWorker.js';
import type { SavedLink } from '../src/links/saveLink.js';
import { silentLogger } from './helpers.js';

function queue(urls: string[]) {
  let rows: ClaimedImport[] = urls.map((url, i) => ({
    id: String(i),
    batchId: 'b',
    userId: 'u',
    url,
  }));
  const finished: [string, string][] = [];
  const repo: LinkImportRepository = {
    enqueue: async () => 'b',
    queuedCount: async () => rows.length,
    async claim(limit) {
      const taken = rows.slice(0, limit);
      rows = rows.slice(limit);
      return taken;
    },
    finish: async (id, outcome) => void finished.push([id, outcome]),
    takeFinished: async () => [],
  };
  return { repo, finished };
}

describe('link import worker', () => {
  it('reads one page at a time per site, with a gap, but different sites in parallel', async () => {
    const urls = [
      'https://a.example/1',
      'https://a.example/2',
      'https://a.example/3',
      'https://b.example/1',
    ];
    const { repo } = queue(urls);
    const calls: { url: string; at: number }[] = [];
    let inFlight = new Map<string, number>();
    const saveLink = vi.fn(async (_u: string, url: string): Promise<SavedLink> => {
      const host = new URL(url).host;
      inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
      expect(inFlight.get(host)).toBe(1); // never two at once on one site
      calls.push({ url, at: Date.now() });
      await new Promise((r) => setTimeout(r, 5));
      inFlight.set(host, inFlight.get(host)! - 1);
      return { kind: 'invalid', raw: url };
    });
    const worker = createLinkImportWorker({
      imports: repo,
      saveLink,
      line: { push: vi.fn() },
      logger: silentLogger,
      perSiteIntervalMs: 60,
    });
    await worker.drain();
    inFlight = new Map();

    const a = calls.filter((c) => c.url.includes('a.example')).map((c) => c.at);
    expect(a).toHaveLength(3);
    expect(a[1]! - a[0]!).toBeGreaterThanOrEqual(55);
    expect(a[2]! - a[1]!).toBeGreaterThanOrEqual(55);
    // b.example didn't wait behind a.example.
    const b = calls.find((c) => c.url.includes('b.example'))!.at;
    expect(b - a[0]!).toBeLessThan(50);
  });

  it('marks a link failed when saving throws, and carries on', async () => {
    const { repo, finished } = queue(['https://a.example/1', 'https://b.example/1']);
    const worker = createLinkImportWorker({
      imports: repo,
      saveLink: async (_u, url) => {
        if (url.includes('a.example')) throw new Error('db down');
        return { kind: 'invalid', raw: url };
      },
      line: { push: vi.fn() },
      logger: silentLogger,
      perSiteIntervalMs: 0,
    });
    await worker.drain();
    expect(Object.fromEntries(finished)).toEqual({ '0': 'failed', '1': 'invalid' });
  });
});
