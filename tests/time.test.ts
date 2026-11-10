import { describe, expect, it } from 'vitest';
import {
  decideReminder,
  eveningBefore,
  formatWhen,
  parsePickerValue,
  parseTimeOfDay,
  parseWhen,
  relativeDay,
  toPickerValue,
  zonedDate,
} from '../src/interviews/time.js';

const TZ = 'Asia/Bangkok';
// Tuesday 10 Nov 2026, 10:00 in Bangkok.
const NOW = new Date('2026-11-10T03:00:00Z');
const bkk = (iso: string) => new Date(`${iso}+07:00`);

describe('zone helpers', () => {
  it('converts wall time in Bangkok to an instant and back', () => {
    expect(zonedDate(2026, 11, 15, 14, 0, TZ).toISOString()).toBe('2026-11-15T07:00:00.000Z');
    expect(toPickerValue(bkk('2026-11-15T14:00'), TZ)).toBe('2026-11-15T14:00');
    expect(parsePickerValue('2026-11-15T14:00', TZ)).toEqual(bkk('2026-11-15T14:00'));
    expect(parsePickerValue('nonsense', TZ)).toBeNull();
  });

  it('handles zones with daylight saving', () => {
    // 30 Mar 2026 is after the EU switch: London is UTC+1.
    expect(zonedDate(2026, 3, 30, 9, 0, 'Europe/London').toISOString()).toBe(
      '2026-03-30T08:00:00.000Z',
    );
  });

  it('formats in Thai', () => {
    expect(formatWhen(bkk('2026-11-13T14:00'), TZ, NOW)).toBe('ศ. 13 พ.ย. 14:00');
    expect(formatWhen(bkk('2027-01-05T09:30'), TZ, NOW)).toBe('อ. 5 ม.ค. 2570 09:30');
    expect(relativeDay(bkk('2026-11-11T08:00'), NOW, TZ)).toBe('พรุ่งนี้');
    expect(relativeDay(bkk('2026-11-17T08:00'), NOW, TZ)).toBe('อีก 7 วัน');
  });
});

describe('parseTimeOfDay', () => {
  it.each([
    ['14:00', 14, 0],
    ['9.30', 9, 30],
    ['2pm', 14, 0],
    ['2:30 pm', 14, 30],
    ['บ่าย 2', 14, 0],
    ['บ่ายสองโมงครึ่ง', 14, 30],
    ['บ่ายโมง', 13, 0],
    ['สิบโมง', 10, 0],
    ['10 โมงเช้า', 10, 0],
    ['สี่โมงเย็น', 16, 0],
    ['สองทุ่ม', 20, 0],
    ['เที่ยง', 12, 0],
    ['13 น.', 13, 0],
    ['๑๔:๓๐', 14, 30],
  ])('%s', (text, hour, minute) => {
    const s = text
      .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
      .replace('สองโมง', '2โมง')
      .replace('สิบโมง', '10โมง')
      .replace('สี่โมง', '4โมง')
      .replace('สองทุ่ม', '2ทุ่ม');
    expect(parseTimeOfDay(s)).toEqual({ hour, minute });
  });
});

describe('parseWhen', () => {
  const ok = (text: string) => {
    const r = parseWhen(text, NOW, TZ);
    if (r.kind !== 'ok') throw new Error(`${text} -> ${r.kind}`);
    return r.date;
  };

  it.each([
    ['พรุ่งนี้ 14:00', '2026-11-11T14:00'],
    ['พรุ่งนี้ บ่ายสอง', '2026-11-11T14:00'],
    ['มะรืนนี้ 9 โมงเช้า', '2026-11-12T09:00'],
    ['15/11 10:30', '2026-11-15T10:30'],
    ['15/11/2569 10:30', '2026-11-15T10:30'],
    ['20 พ.ย. สิบโมง', '2026-11-20T10:00'],
    ['3 ธันวาคม 13:30', '2026-12-03T13:30'],
    ['5 jan 9am', '2027-01-05T09:00'],
    ['ศุกร์ บ่ายสาม', '2026-11-13T15:00'],
    ['วันศุกร์หน้า 10:00', '2026-11-20T10:00'],
    ['อังคาร 15:00', '2026-11-10T15:00'],
    ['16:00', '2026-11-10T16:00'],
    ['8:00', '2026-11-11T08:00'],
    ['๑๕/๑๑ ๑๐:๓๐', '2026-11-15T10:30'],
    ['5/1 9:00', '2027-01-05T09:00'],
  ])('%s', (text, expected) => {
    expect(ok(text)).toEqual(bkk(expected));
  });

  it('asks for a time when only a date is given', () => {
    expect(parseWhen('พรุ่งนี้', NOW, TZ).kind).toBe('no-time');
    expect(parseWhen('15/11', NOW, TZ).kind).toBe('no-time');
  });

  it('flags times in the past and nonsense', () => {
    expect(parseWhen('วันนี้ 9:00', NOW, TZ).kind).toBe('past');
    expect(parseWhen('1/1/2020 9:00', NOW, TZ).kind).toBe('past');
    expect(parseWhen('31/2 10:00', NOW, TZ).kind).toBe('invalid');
    expect(parseWhen('สวัสดีครับ', NOW, TZ).kind).toBe('invalid');
  });
});

describe('decideReminder', () => {
  const start = bkk('2026-11-12T14:00');
  const base = {
    startsAt: start,
    scheduledAt: bkk('2026-11-05T10:00'),
    remindedEveningAt: null,
    remindedSoonAt: null,
  };

  it('reminds at 19:00 the evening before', () => {
    expect(eveningBefore(start, TZ)).toEqual(bkk('2026-11-11T19:00'));
    expect(decideReminder(base, bkk('2026-11-11T18:59'), TZ).send).toBeNull();
    expect(decideReminder(base, bkk('2026-11-11T19:00'), TZ)).toEqual({
      send: 'evening',
      skip: [],
    });
  });

  it('reminds two hours before, once', () => {
    expect(
      decideReminder({ ...base, remindedEveningAt: NOW }, bkk('2026-11-12T12:01'), TZ),
    ).toEqual({ send: 'soon', skip: [] });
    expect(
      decideReminder(
        { ...base, remindedEveningAt: NOW, remindedSoonAt: NOW },
        bkk('2026-11-12T12:30'),
        TZ,
      ).send,
    ).toBeNull();
  });

  it('sends only the latest reminder after downtime', () => {
    expect(decideReminder(base, bkk('2026-11-12T13:00'), TZ)).toEqual({
      send: 'soon',
      skip: ['evening'],
    });
  });

  it('skips reminders whose moment had passed when the interview was booked', () => {
    const late = { ...base, scheduledAt: bkk('2026-11-11T20:00') };
    expect(decideReminder(late, bkk('2026-11-11T20:05'), TZ)).toEqual({
      send: null,
      skip: ['evening'],
    });
    const veryLate = { ...base, scheduledAt: bkk('2026-11-12T13:00') };
    expect(decideReminder(veryLate, bkk('2026-11-12T13:05'), TZ)).toEqual({
      send: null,
      skip: ['evening', 'soon'],
    });
  });

  it('does nothing once the interview has started', () => {
    expect(decideReminder(base, start, TZ).send).toBeNull();
  });
});
