import { describe, expect, it } from 'vitest';
import {
  parseExcluded,
  parseLocations,
  parsePositions,
  parseSalary,
  parseWorkMode,
  splitList,
} from '../src/prefs/parse.js';

describe('splitList', () => {
  it('splits on commas, slashes and newlines, trims and de-duplicates case-insensitively', () => {
    expect(splitList(' Data Analyst ,data analyst/ BA\nQA ')).toEqual(['Data Analyst', 'BA', 'QA']);
  });
});

describe('parsePositions', () => {
  it('accepts up to five positions', () => {
    expect(parsePositions('A1, B2, C3, D4, E5')).toEqual({
      ok: true,
      value: ['A1', 'B2', 'C3', 'D4', 'E5'],
    });
  });
  it('rejects empty input, more than five, and single characters', () => {
    expect(parsePositions(' , ').ok).toBe(false);
    expect(parsePositions('A1,B2,C3,D4,E5,F6').ok).toBe(false);
    expect(parsePositions('A').ok).toBe(false);
  });
});

describe('parseLocations', () => {
  it('treats "ทั่วประเทศ" as anywhere', () => {
    expect(parseLocations('ทั่วประเทศ')).toEqual({ ok: true, value: [] });
  });
  it('splits multiple locations', () => {
    expect(parseLocations('กรุงเทพฯ, นนทบุรี')).toEqual({
      ok: true,
      value: ['กรุงเทพฯ', 'นนทบุรี'],
    });
  });
});

describe('parseWorkMode', () => {
  it.each([
    ['remote', 'remote'],
    ['WFH', 'remote'],
    ['ทำจากบ้าน', 'remote'],
    ['Hybrid', 'hybrid'],
    ['เข้าออฟฟิศ', 'onsite'],
    ['ไม่จำกัด', 'any'],
  ])('%s -> %s', (input, expected) => {
    expect(parseWorkMode(input)).toEqual({ ok: true, value: expected });
  });
  it('rejects unknown text', () => {
    expect(parseWorkMode('บนดวงจันทร์').ok).toBe(false);
  });
});

describe('parseSalary', () => {
  it.each([
    ['25000', 25000],
    ['25,000', 25000],
    ['25k', 25000],
    ['25K บาท', 25000],
    ['2.5หมื่น', 25000],
    ['30พัน', 30000],
    ['ไม่ระบุ', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseSalary(input)).toEqual({ ok: true, value: expected });
  });
  it.each(['เยอะๆ', '500', '5000000', '-3'])('rejects %s', (input) => {
    expect(parseSalary(input).ok).toBe(false);
  });
});

describe('parseExcluded', () => {
  it('accepts skip and lists', () => {
    expect(parseExcluded('ข้าม')).toEqual({ ok: true, value: [] });
    expect(parseExcluded('ขายตรง, MLM')).toEqual({ ok: true, value: ['ขายตรง', 'MLM'] });
  });
});
