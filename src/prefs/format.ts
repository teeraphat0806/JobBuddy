import { WORK_MODE_LABELS, type PrefsInput } from './types.js';

export function formatSalary(value: number | null): string {
  return value === null ? 'ไม่ระบุ' : `${value.toLocaleString('en-US')} บาทขึ้นไป`;
}

export function formatPrefs(p: PrefsInput): string {
  return [
    `💼 ตำแหน่ง: ${p.positions.join(', ')}`,
    `📍 พื้นที่: ${p.locations.length ? p.locations.join(', ') : 'ทั่วประเทศ'}`,
    `🏢 รูปแบบงาน: ${WORK_MODE_LABELS[p.workMode]}`,
    `💰 เงินเดือน: ${formatSalary(p.minSalary)}`,
    `🚫 ไม่อยากเห็น: ${p.excludedKeywords.length ? p.excludedKeywords.join(', ') : '-'}`,
  ].join('\n');
}
