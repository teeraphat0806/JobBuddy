/**
 * Wall-clock helpers for one IANA time zone (the app's APP_TIMEZONE), plus a parser for the
 * ways Thai users type an appointment time ("พรุ่งนี้ บ่ายสอง", "15/11 10:30", "ศุกร์ 2 ทุ่ม").
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): LocalParts {
  const p = Object.fromEntries(
    partsFormatter(tz)
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAY_INDEX[p.weekday ?? ''] ?? 0,
  };
}

/** The instant when the clock in `tz` shows the given wall time. Day overflow is normalised. */
export function zonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  // Two passes settle the offset, including around DST changes.
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - shown;
  }
  return new Date(guess);
}

/** LINE datetimepicker values look like "2026-11-15T14:00" (the user's wall time). */
export function parsePickerValue(value: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedDate(y, mo, d, h, mi, tz);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toPickerValue(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const TH_WEEKDAY = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_MONTH = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

/** "ศ. 15 พ.ย. 14:00" (adds the Buddhist-era year when it isn't this year). */
export function formatWhen(date: Date, tz: string, now = new Date()): string {
  const p = localParts(date, tz);
  const year = p.year !== localParts(now, tz).year ? ` ${p.year + 543}` : '';
  return `${TH_WEEKDAY[p.weekday]} ${p.day} ${TH_MONTH[p.month - 1]}${year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Whole calendar days from `now` to `date` in `tz`. */
export function daysUntil(date: Date, now: Date, tz: string): number {
  const a = localParts(now, tz);
  const b = localParts(date, tz);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

export function relativeDay(date: Date, now: Date, tz: string): string {
  const d = daysUntil(date, now, tz);
  if (d === 0) return 'วันนี้';
  if (d === 1) return 'พรุ่งนี้';
  if (d === 2) return 'มะรืนนี้';
  return d > 0 ? `อีก ${d} วัน` : `${-d} วันก่อน`;
}

// ---- Parsing typed times

const THAI_DIGITS = /[๐-๙]/g;
const NUMBER_WORDS: [RegExp, string][] = [
  [/สิบเอ็ด/g, '11'],
  [/สิบสอง/g, '12'],
  [/สิบ/g, '10'],
  [/หนึ่ง|นึง/g, '1'],
  [/สอง/g, '2'],
  [/สาม/g, '3'],
  [/สี่/g, '4'],
  [/ห้า/g, '5'],
  [/หก/g, '6'],
  [/เจ็ด/g, '7'],
  [/แปด/g, '8'],
  [/เก้า/g, '9'],
];

const MONTHS: [RegExp, number][] = [
  [/^(ม\.?ค\.?|มกรา(คม)?|jan(uary)?)$/, 1],
  [/^(ก\.?พ\.?|กุมภา(พันธ์)?|feb(ruary)?)$/, 2],
  [/^(มี\.?ค\.?|มีนา(คม)?|mar(ch)?)$/, 3],
  [/^(เม\.?ย\.?|เมษา(ยน)?|apr(il)?)$/, 4],
  [/^(พ\.?ค\.?|พฤษภา(คม)?|may)$/, 5],
  [/^(มิ\.?ย\.?|มิถุนา(ยน)?|jun(e)?)$/, 6],
  [/^(ก\.?ค\.?|กรกฎา(คม)?|jul(y)?)$/, 7],
  [/^(ส\.?ค\.?|สิงหา(คม)?|aug(ust)?)$/, 8],
  [/^(ก\.?ย\.?|กันยา(ยน)?|sep(t(ember)?)?)$/, 9],
  [/^(ต\.?ค\.?|ตุลา(คม)?|oct(ober)?)$/, 10],
  [/^(พ\.?ย\.?|พฤศจิกา(ยน)?|nov(ember)?)$/, 11],
  [/^(ธ\.?ค\.?|ธันวา(คม)?|dec(ember)?)$/, 12],
];
const MONTH_TOKEN =
  '(ม\\.?ค\\.?|ก\\.?พ\\.?|มี\\.?ค\\.?|เม\\.?ย\\.?|พ\\.?ค\\.?|มิ\\.?ย\\.?|ก\\.?ค\\.?|ส\\.?ค\\.?|ก\\.?ย\\.?|ต\\.?ค\\.?|พ\\.?ย\\.?|ธ\\.?ค\\.?|' +
  '[ก-๙]+(?:คม|ยน|พันธ์)|[a-z]{3,9})';

const WEEKDAYS: [RegExp, number][] = [
  [/อาทิตย์|\bsun(day)?\b/, 0],
  [/จันทร์|\bmon(day)?\b/, 1],
  [/อังคาร|\btue(s(day)?)?\b/, 2],
  [/พุธ|\bwed(nesday)?\b/, 3],
  [/พฤหัส(บดี)?|\bthu(r(s(day)?)?)?\b/, 4],
  [/ศุกร์|\bfri(day)?\b/, 5],
  [/เสาร์|\bsat(urday)?\b/, 6],
];

function monthOf(token: string): number | null {
  for (const [re, m] of MONTHS) if (re.test(token)) return m;
  return null;
}

function normalise(text: string): string {
  let s = text.toLowerCase().replace(THAI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0e50));
  for (const [re, n] of NUMBER_WORDS) s = s.replace(re, n);
  return s.replace(/\s+/g, ' ').trim();
}

/** Hour and minute from free text, or null. Exported for tests. */
export function parseTimeOfDay(s: string): { hour: number; minute: number } | null {
  const half = /ครึ่ง/.test(s) ? 30 : 0;
  let m: RegExpExecArray | null;

  if ((m = /(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/.exec(s))) {
    let hour = Number(m[1]);
    const minute = Number(m[2]);
    if (m[3]?.startsWith('p') && hour < 12) hour += 12;
    if (m[3]?.startsWith('a') && hour === 12) hour = 0;
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }
  if ((m = /(\d{1,2})\s*(am|pm)\b/.exec(s))) {
    let hour = Number(m[1]) % 12;
    if (m[2] === 'pm') hour += 12;
    return { hour, minute: half };
  }
  if (/เที่ยงคืน/.test(s)) return { hour: 0, minute: half };
  if (/เที่ยง/.test(s)) return { hour: 12, minute: half };
  if ((m = /บ่าย\s*(\d{1,2})?/.exec(s))) {
    const n = m[1] ? Number(m[1]) : 1;
    return n >= 1 && n <= 5 ? { hour: 12 + n, minute: half } : null;
  }
  if ((m = /(\d{1,2})?\s*ทุ่ม/.exec(s))) {
    const n = m[1] ? Number(m[1]) : 1;
    return n >= 1 && n <= 5 ? { hour: 18 + n, minute: half } : null;
  }
  if ((m = /(\d{1,2})\s*โมง\s*(เช้า|เย็น)?/.exec(s))) {
    const n = Number(m[1]);
    if (m[2] === 'เย็น') return n >= 1 && n <= 6 ? { hour: 12 + n, minute: half } : null;
    if (m[2] === 'เช้า') return n >= 5 && n <= 11 ? { hour: n, minute: half } : null;
    // Plain "สองโมง" means 2 pm; "เก้าโมง" means 9 am.
    if (n >= 1 && n <= 6) return { hour: 12 + n, minute: half };
    return n <= 12 ? { hour: n, minute: half } : null;
  }
  if ((m = /(\d{1,2})\s*น\.?(?![ก-๙])/.exec(s))) {
    const hour = Number(m[1]);
    return hour <= 23 ? { hour, minute: half } : null;
  }
  return null;
}

export type ParsedWhen =
  | { kind: 'ok'; date: Date }
  | { kind: 'past'; date: Date }
  | { kind: 'no-time' }
  | { kind: 'invalid' };

/** Understands a typed appointment time relative to `now`, in `tz`. */
export function parseWhen(text: string, now: Date, tz: string): ParsedWhen {
  let s = normalise(text);
  const today = localParts(now, tz);
  let date: { year: number; month: number; day: number } | null = null;
  let explicitYear = false;

  const addDays = (n: number) => {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + n));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  };

  let m: RegExpExecArray | null;
  if ((m = /(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?/.exec(s))) {
    let year = m[3] ? Number(m[3]) : today.year;
    if (m[3]) {
      explicitYear = true;
      if (year < 100) year += year > 50 ? 2500 : 2000;
      if (year > 2400) year -= 543;
    }
    date = { year, month: Number(m[2]), day: Number(m[1]) };
    s = s.replace(m[0], ' ');
  } else if ((m = new RegExp(`(\\d{1,2})\\s*${MONTH_TOKEN}(?:\\s*(\\d{4}))?`).exec(s))) {
    const month = monthOf(m[2]!);
    if (month) {
      let year = m[3] ? Number(m[3]) : today.year;
      if (m[3]) {
        explicitYear = true;
        if (year > 2400) year -= 543;
      }
      date = { year, month, day: Number(m[1]) };
      s = s.replace(m[0], ' ');
    }
  }

  if (!date) {
    if (/วันนี้|today/.test(s)) date = addDays(0);
    else if (/มะรืน/.test(s)) date = addDays(2);
    else if (/พรุ่งนี้|tomorrow/.test(s)) date = addDays(1);
    else {
      for (const [re, wd] of WEEKDAYS) {
        if (!re.test(s)) continue;
        let ahead = (wd - today.weekday + 7) % 7;
        if (/หน้า|next/.test(s)) ahead += 7;
        date = addDays(ahead);
        break;
      }
    }
  }

  const time = parseTimeOfDay(s);
  if (!time) return date ? { kind: 'no-time' } : { kind: 'invalid' };

  let result: Date;
  if (date) {
    if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) {
      return { kind: 'invalid' };
    }
    result = zonedDate(date.year, date.month, date.day, time.hour, time.minute, tz);
    // Reject 31/02 etc. rather than silently rolling into the next month.
    if (localParts(result, tz).day !== date.day) return { kind: 'invalid' };
    // "15/1" typed in November means next January.
    if (!explicitYear && result <= now && daysUntil(result, now, tz) < 0) {
      result = zonedDate(date.year + 1, date.month, date.day, time.hour, time.minute, tz);
    }
  } else {
    // Just a time: today if it's still ahead, otherwise tomorrow.
    result = zonedDate(today.year, today.month, today.day, time.hour, time.minute, tz);
    if (result <= now) {
      const t = addDays(1);
      result = zonedDate(t.year, t.month, t.day, time.hour, time.minute, tz);
    }
  }
  return result > now ? { kind: 'ok', date: result } : { kind: 'past', date: result };
}

// ---- Reminder timing

export const SOON_BEFORE_MS = 2 * 60 * 60 * 1000;
export const EVENING_HOUR = 19;

/** 19:00 local on the day before the interview. */
export function eveningBefore(startsAt: Date, tz: string): Date {
  const p = localParts(startsAt, tz);
  return zonedDate(p.year, p.month, p.day - 1, EVENING_HOUR, 0, tz);
}

export interface ReminderState {
  startsAt: Date;
  scheduledAt: Date;
  remindedEveningAt: Date | null;
  remindedSoonAt: Date | null;
}

export interface ReminderDecision {
  send: 'evening' | 'soon' | null;
  /** Reminders whose moment passed without being sent (e.g. booked too late): mark them done. */
  skip: ('evening' | 'soon')[];
}

export function decideReminder(iv: ReminderState, now: Date, tz: string): ReminderDecision {
  const none: ReminderDecision = { send: null, skip: [] };
  if (now >= iv.startsAt) return none;
  const soonAt = new Date(iv.startsAt.getTime() - SOON_BEFORE_MS);
  const eveningAt = eveningBefore(iv.startsAt, tz);

  if (now >= soonAt) {
    const skip: ReminderDecision['skip'] = iv.remindedEveningAt ? [] : ['evening'];
    if (iv.remindedSoonAt) return { send: null, skip };
    // Booked within the last two hours: the user already knows, don't push.
    if (iv.scheduledAt >= soonAt) return { send: null, skip: [...skip, 'soon'] };
    return { send: 'soon', skip };
  }
  if (now >= eveningAt && !iv.remindedEveningAt) {
    if (iv.scheduledAt >= eveningAt) return { send: null, skip: ['evening'] };
    return { send: 'evening', skip: [] };
  }
  return none;
}
