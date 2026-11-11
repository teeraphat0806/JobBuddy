import { describe, expect, it } from 'vitest';
import {
  describeStation,
  formatWalk,
  nearestStation,
  stationInText,
  stationName,
  STATIONS,
} from '../src/geo/stations.js';
import { createFakeBot } from './fakes.js';

const station = (line: string, th: string) => STATIONS.find((s) => s.line === line && s.th === th)!;
const SIAM = station('BTS', 'สยาม');

describe('station data', () => {
  it('covers every line around Bangkok', () => {
    for (const line of ['BTS', 'MRT', 'ARL', 'RED']) {
      expect(STATIONS.filter((s) => s.line === line).length).toBeGreaterThan(5);
    }
    for (const s of STATIONS) {
      expect(s.lat).toBeGreaterThan(13.4);
      expect(s.lat).toBeLessThan(14.2);
      expect(s.lng).toBeGreaterThan(100.2);
      expect(s.lng).toBeLessThan(101);
    }
    expect(SIAM).toBeDefined();
  });
});

describe('stations named in the location text', () => {
  it.each([
    ['ใกล้ BTS อโศก, กรุงเทพฯ', 'BTS อโศก'],
    ['Siam Paragon (BTS Siam), Bangkok', 'BTS สยาม'],
    ['Samyan Mitrtown, MRT Sam Yan', 'MRT สามย่าน'],
    ['อาคารเอ็มไพร์ ติดรถไฟฟ้าช่องนนทรี', 'BTS ช่องนนทรี'],
  ])('%s -> %s', (text, name) => {
    expect(stationName(stationInText(text)!)).toBe(name);
  });

  it('ignores station-like names when the text says nothing about trains', () => {
    expect(stationInText('Asok, Bangkok')).toBeNull();
    expect(stationInText('สยามพิวรรธน์ ปทุมวัน')).toBeNull();
  });
});

describe('describeStation', () => {
  const near = { lat: SIAM.lat + 0.0025, lng: SIAM.lng }; // ~280 m north

  it('gives a walking distance for street-level points', () => {
    expect(describeStation('x', { ...near, rank: 30 })).toMatch(/^BTS สยาม ~\d+0 ม\.$/);
  });

  it('only says "around" for a neighbourhood, and nothing for a whole district', () => {
    expect(describeStation('x', { ...near, rank: 18 })).toBe('แถว BTS สยาม');
    expect(describeStation('x', { ...near, rank: 12 })).toBeNull();
    expect(describeStation('x', { ...near, rank: null })).toBeNull();
  });

  it('says nothing far from any station', () => {
    expect(describeStation('x', { lat: 18.79, lng: 98.98, rank: 30 })).toBeNull(); // Chiang Mai
    expect(nearestStation({ lat: 18.79, lng: 98.98 }, 2)).toBeNull();
  });

  it('prefers what the posting itself says', () => {
    expect(describeStation('ใกล้ MRT สามย่าน', { ...near, rank: 30 })).toBe('ใกล้ MRT สามย่าน');
  });

  it('formats short walks in metres', () => {
    expect(formatWalk(0.28)).toBe('~300 ม.');
    expect(formatWalk(0.01)).toBe('~50 ม.');
    expect(formatWalk(1.24)).toBe('~1.2 กม.');
  });
});

describe('stations on job cards', () => {
  async function readyBot() {
    const bot = createFakeBot();
    await bot.follow();
    await bot.tap({ a: 'consent', v: 'accept' });
    await bot.tap({ a: 'wiz', v: 'cancel' });
    return bot;
  }

  it('shows the nearest station in job details, even with no home set', async () => {
    const bot = await readyBot();
    bot.geoPoints.set('siam paragon, bangkok', {
      lat: SIAM.lat + 0.0025,
      lng: SIAM.lng,
      rank: 30,
    });
    const id = bot.addJob({ title: 'Barista', location: 'Siam Paragon, Bangkok' });
    await bot.tap({ a: 'job', v: 'save', j: id });
    const [detail] = await bot.tap({ a: 'job', v: 'detail', j: id });
    expect(detail).toMatch(/🚇 BTS สยาม ~\d+ ม\./);
    expect(detail).not.toContain('📏');
  });

  it('lists the station from the posting text without any lookup', async () => {
    const bot = await readyBot();
    const id = bot.addJob({ title: 'Sales', location: 'ใกล้ BTS อโศก' });
    await bot.tap({ a: 'job', v: 'save', j: id });
    await bot.tap({ a: 'menu', m: 'saved' });
    expect(JSON.stringify(bot.lastReply())).toContain('🚇 ใกล้ BTS อโศก');
  });
});
