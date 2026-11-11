import type { messagingApi } from '@line/bot-sdk';
import { describe, expect, it, vi } from 'vitest';
import { describeDistances, directionsUrl, distanceKm, formatKm } from '../src/geo/distance.js';
import { createNominatimGeocoder, geoQuery } from '../src/geo/geocoder.js';
import { decodePostback } from '../src/line/postback.js';
import { createFakeBot } from './fakes.js';

// Real coordinates, roughly.
const HUAI_KHWANG = { lat: 13.7786, lng: 100.5746 };
const ASOK = { lat: 13.7373, lng: 100.5603 };
const BANG_NA = { lat: 13.668, lng: 100.6045 };

async function readyBot() {
  const bot = createFakeBot();
  await bot.follow();
  await bot.tap({ a: 'consent', v: 'accept' });
  await bot.tap({ a: 'wiz', v: 'cancel' });
  return bot;
}
type Bot = Awaited<ReturnType<typeof readyBot>>;

function quickReplies(bot: Bot) {
  const last = bot.lastReply().at(-1) as messagingApi.TextMessage;
  return (last.quickReply?.items ?? []).map((i) => i.action!);
}

describe('distance math', () => {
  it('measures straight-line distance', () => {
    expect(distanceKm(HUAI_KHWANG, ASOK)).toBeGreaterThan(4.5);
    expect(distanceKm(HUAI_KHWANG, ASOK)).toBeLessThan(5);
    expect(distanceKm(ASOK, ASOK)).toBe(0);
  });

  it('formats approximately', () => {
    expect(formatKm(4.567)).toBe('~4.6 กม.');
    expect(formatKm(12.4)).toBe('~12 กม.');
  });

  it('lists places nearest first', () => {
    const text = describeDistances(
      [
        { label: 'บ้าน', ...BANG_NA },
        { label: 'คอนโด', ...ASOK },
      ],
      HUAI_KHWANG,
    );
    expect(text).toMatch(/^คอนโด ~4\.\d กม\. · บ้าน ~1\d กม\.$/);
  });

  it('links to directions without the user’s own location', () => {
    expect(directionsUrl(HUAI_KHWANG)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=13.77860,100.57460',
    );
  });
});

describe('geoQuery', () => {
  it('normalises job locations', () => {
    expect(geoQuery('Huai Khwang, Bangkok, Thailand')).toBe('huai khwang, bangkok');
    expect(geoQuery('Bangkok; Remote')).toBe('bangkok');
    expect(geoQuery('บางเสาธง, สมุทรปราการ ประเทศไทย')).toBe('บางเสาธง, สมุทรปราการ');
  });

  it('skips remote and empty locations', () => {
    expect(geoQuery('')).toBeNull();
    expect(geoQuery('Remote')).toBeNull();
    expect(geoQuery('Thailand')).toBeNull();
  });
});

describe('Nominatim geocoder', () => {
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  it('identifies itself, asks Thailand only, and rejects province-level matches', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      expect(u.searchParams.get('countrycodes')).toBe('th');
      expect((init?.headers as Record<string, string>)['User-Agent']).toBe('JobBuddy/test');
      return u.searchParams.get('q') === 'bangkok'
        ? reply([{ lat: '13.75', lon: '100.49', place_rank: 7, display_name: 'Bangkok' }])
        : reply([{ lat: '13.77', lon: '100.57', place_rank: 12, display_name: 'Huai Khwang' }]);
    });
    const g = createNominatimGeocoder({
      userAgent: 'JobBuddy/test',
      fetchImpl: fetchImpl as typeof fetch,
      minIntervalMs: 0,
    });
    expect(await g('bangkok')).toBeNull();
    expect(await g('huai khwang, bangkok')).toEqual({
      lat: 13.77,
      lng: 100.57,
      label: 'Huai Khwang',
    });
  });

  it('retries with the first part when the full text is not found', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const q = new URL(String(url)).searchParams.get('q')!;
      seen.push(q);
      return reply(q === 'บางเสาธง' ? [{ lat: '13.58', lon: '100.79', place_rank: 16 }] : []);
    });
    const g = createNominatimGeocoder({
      userAgent: 'x',
      fetchImpl: fetchImpl as typeof fetch,
      minIntervalMs: 0,
    });
    expect(await g('บางเสาธง, สมุทรปราการ')).toMatchObject({ lat: 13.58, lng: 100.79 });
    expect(seen).toEqual(['บางเสาธง, สมุทรปราการ', 'บางเสาธง']);
  });
});

describe('places (home, condo)', () => {
  it('asks for a location, saves it as บ้าน and lets the user name the next one', async () => {
    const bot = await readyBot();
    expect((await bot.say('บ้าน'))[0]).toContain('ส่งตำแหน่งบ้าน');
    expect(quickReplies(bot)[0]?.type).toBe('location');

    expect((await bot.shareLocation(BANG_NA.lat, BANG_NA.lng))[0]).toContain('"บ้าน"');
    await bot.shareLocation(ASOK.lat, ASOK.lng);
    expect(bot.placeRows.map((p) => p.label)).toEqual(['บ้าน', 'ที่พัก 2']);

    // Suggested names are buttons...
    const condo = quickReplies(bot).find(
      (a) => a.label === '🏢 คอนโด',
    ) as messagingApi.PostbackAction;
    await bot.tap(decodePostback(condo.data!));
    expect(bot.placeRows[1]?.label).toBe('คอนโด');

    // ...or the user types one.
    await bot.tap({ a: 'place', v: 'ask', i: bot.placeRows[1]!.id });
    await bot.say('คอนโดอโศก');
    expect(bot.placeRows[1]?.label).toBe('คอนโดอโศก');

    const list = await bot.say('บ้าน');
    expect(list[0]).toContain('ที่พักของคุณ (2/5)');
    expect(list[0]).toContain('OpenStreetMap');
  });

  it('removes a place and caps the number of places', async () => {
    const bot = await readyBot();
    for (let i = 0; i < 5; i++) await bot.shareLocation(13.7 + i / 100, 100.5);
    expect((await bot.shareLocation(13.8, 100.6))[0]).toContain('สูงสุด 5');
    await bot.tap({ a: 'place', v: 'del', i: bot.placeRows[0]!.id });
    expect(bot.placeRows).toHaveLength(4);
  });

  it('never lets one user touch another user’s place', async () => {
    const bot = await readyBot();
    await bot.shareLocation(ASOK.lat, ASOK.lng);
    await bot.follow('U2');
    await bot.tap({ a: 'consent', v: 'accept' }, 'U2');
    await bot.tap({ a: 'place', v: 'del', i: bot.placeRows[0]!.id }, 'U2');
    await bot.tap({ a: 'place', v: 'name', i: bot.placeRows[0]!.id, l: 'x' }, 'U2');
    expect(bot.placeRows).toHaveLength(1);
    expect(bot.placeRows[0]?.label).toBe('บ้าน');
  });
});

describe('distances on jobs', () => {
  async function withPlaces() {
    const bot = await readyBot();
    await bot.shareLocation(BANG_NA.lat, BANG_NA.lng);
    await bot.shareLocation(ASOK.lat, ASOK.lng);
    await bot.tap({ a: 'place', v: 'name', i: bot.placeRows[1]!.id, l: 'คอนโด' });
    bot.geoPoints.set('huai khwang, bangkok', HUAI_KHWANG);
    return bot;
  }

  it('shows distance from every place and a directions button in the job details', async () => {
    const bot = await withPlaces();
    const id = bot.addJob({ title: 'QA', location: 'Huai Khwang, Bangkok, Thailand' });
    await bot.tap({ a: 'job', v: 'save', j: id });
    const detail = await bot.tap({ a: 'job', v: 'detail', j: id });
    expect(detail[0]).toMatch(/📏 คอนโด ~4\.\d กม\. · บ้าน ~1\d กม\. \(เส้นตรง\)/);
    const maps = quickReplies(bot).find((a) => a.label === '🗺️ เส้นทาง') as messagingApi.URIAction;
    expect(maps.uri).toBe('https://www.google.com/maps/dir/?api=1&destination=13.77860,100.57460');
    // Only the job's location went to the geocoder, never the user's places.
    expect(bot.geocoder.mock.calls).toEqual([['huai khwang, bangkok']]);
  });

  it('uses cached locations in lists and looks up unknown ones in the background', async () => {
    const bot = await withPlaces();
    const id = bot.addJob({ title: 'QA', location: 'Huai Khwang, Bangkok' });
    await bot.tap({ a: 'job', v: 'save', j: id });

    await bot.tap({ a: 'menu', m: 'saved' });
    expect(JSON.stringify(bot.lastReply()[0])).not.toContain('📏');
    await bot.geo.idle();
    await bot.tap({ a: 'menu', m: 'saved' });
    // The list row shows only the nearest place.
    expect(JSON.stringify(bot.lastReply()[0])).toMatch(
      /📏 ~4\.\d กม\. \(คอนโด\)|📏 คอนโด ~4\.\d กม\./,
    );
    expect(bot.geocoder).toHaveBeenCalledTimes(1);
  });

  it('shows no distance for remote jobs, whole provinces, or users without places', async () => {
    const bot = await withPlaces();
    const remote = bot.addJob({
      title: 'A',
      location: 'Huai Khwang, Bangkok',
      workplace: 'remote',
    });
    const province = bot.addJob({ title: 'B', location: 'Bangkok, Thailand' });
    for (const j of [remote, province]) {
      expect((await bot.tap({ a: 'job', v: 'detail', j }))[0]).not.toContain('📏');
    }

    await bot.follow('U2');
    await bot.tap({ a: 'consent', v: 'accept' }, 'U2');
    const job = bot.addJob({ title: 'C', location: 'Huai Khwang, Bangkok' });
    expect((await bot.tap({ a: 'job', v: 'detail', j: job }, 'U2'))[0]).not.toContain('📏');
  });
});
