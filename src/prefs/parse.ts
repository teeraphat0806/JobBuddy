import { WORK_MODE_LABELS, WORK_MODES, type WorkMode } from './types.js';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const SKIP_WORDS = ['ข้าม', 'ไม่มี', 'ไม่ระบุ', 'ไม่จำกัด', '-', 'skip', 'none'];

export function isSkip(input: string): boolean {
  return SKIP_WORDS.includes(input.trim().toLowerCase());
}

/** Split "a, b / c" or multi-line input into a de-duplicated list. */
export function splitList(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/[,\n/、|]+/)) {
    const item = part.trim().replace(/\s+/g, ' ');
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function parsePositions(input: string): Parsed<string[]> {
  const items = splitList(input);
  if (items.length === 0) return { ok: false, error: 'พิมพ์ชื่อตำแหน่งอย่างน้อย 1 ตำแหน่งนะครับ' };
  if (items.length > 5) return { ok: false, error: 'ใส่ได้สูงสุด 5 ตำแหน่งครับ' };
  const bad = items.find((p) => [...p].length < 2 || [...p].length > 60);
  if (bad) return { ok: false, error: `ชื่อตำแหน่ง "${bad}" สั้นหรือยาวเกินไป (2–60 ตัวอักษร)` };
  return { ok: true, value: items };
}

const ANYWHERE = ['ทั่วประเทศ', 'ที่ไหนก็ได้', 'ทุกที่', 'anywhere'];

export function parseLocations(input: string): Parsed<string[]> {
  const trimmed = input.trim().toLowerCase();
  if (ANYWHERE.includes(trimmed) || isSkip(input)) return { ok: true, value: [] };
  const items = splitList(input);
  if (items.length === 0) return { ok: false, error: 'พิมพ์จังหวัดหรือพื้นที่ที่อยากทำงานครับ' };
  if (items.length > 5) return { ok: false, error: 'ใส่ได้สูงสุด 5 พื้นที่ครับ' };
  if (items.some((l) => [...l].length > 60))
    return { ok: false, error: 'ชื่อพื้นที่ยาวเกินไปครับ' };
  return { ok: true, value: items };
}

export function parseWorkMode(input: string): Parsed<WorkMode> {
  const t = input.trim().toLowerCase();
  if ((WORK_MODES as readonly string[]).includes(t)) return { ok: true, value: t as WorkMode };
  for (const mode of WORK_MODES) {
    if (WORK_MODE_LABELS[mode].toLowerCase() === t) return { ok: true, value: mode };
  }
  if (/remote|wfh|ทำจากบ้าน|ที่บ้าน/.test(t)) return { ok: true, value: 'remote' };
  if (/hybrid|ไฮบริด/.test(t)) return { ok: true, value: 'hybrid' };
  if (/ออฟฟิศ|office|onsite|on-site/.test(t)) return { ok: true, value: 'onsite' };
  if (isSkip(input) || /ได้หมด|อะไรก็ได้/.test(t)) return { ok: true, value: 'any' };
  return { ok: false, error: 'เลือกรูปแบบการทำงานจากปุ่มด้านล่างได้เลยครับ' };
}

const MULTIPLIERS: Record<string, number> = { k: 1_000, พัน: 1_000, หมื่น: 10_000 };

/** Accepts "25000", "25,000", "25k", "2.5หมื่น", "25,000 บาท". */
export function parseSalary(input: string): Parsed<number | null> {
  if (isSkip(input)) return { ok: true, value: null };
  const cleaned = input
    .replace(/,/g, '')
    .replace(/บาท|thb|฿/gi, '')
    .trim()
    .toLowerCase();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)\s*(k|พัน|หมื่น)?$/);
  if (!m) return { ok: false, error: 'พิมพ์เป็นตัวเลข เช่น 25000 หรือ 25k ครับ' };
  const value = Math.round(Number(m[1]) * (m[2] ? (MULTIPLIERS[m[2]] ?? 1) : 1));
  if (value < 1_000 || value > 1_000_000) {
    return { ok: false, error: 'เงินเดือนควรอยู่ระหว่าง 1,000 – 1,000,000 บาทครับ' };
  }
  return { ok: true, value };
}

export function parseExcluded(input: string): Parsed<string[]> {
  if (isSkip(input)) return { ok: true, value: [] };
  const items = splitList(input);
  if (items.length > 10) return { ok: false, error: 'ใส่ได้สูงสุด 10 คำครับ' };
  if (items.some((k) => [...k].length > 40))
    return { ok: false, error: 'แต่ละคำยาวได้ไม่เกิน 40 ตัวอักษรครับ' };
  return { ok: true, value: items };
}
