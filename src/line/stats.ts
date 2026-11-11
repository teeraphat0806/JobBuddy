import type { ApplicationStage, OverviewRow } from '../jobs/repository.js';
import type { OutgoingMessage } from './messenger.js';
import { daysSince, STAGE_LABEL, STAGES } from './stages.js';
import { postbackButton, text } from './ui.js';

export const STATS_WORDS = ['สรุป', 'สถิติ', 'ภาพรวม', 'stats'];

/** Waiting this long for a callback is worth a nudge (shown in the overview). */
export const LONG_WAIT_DAYS = 14;

export interface JobHuntStats {
  saved: number;
  savedClosed: number;
  applied: number;
  byStage: Record<ApplicationStage, number>;
  /** Still at "applied" after LONG_WAIT_DAYS or more. */
  longWaits: number;
  /** Applications the company got back on (any move past "applied", a "no" included). */
  responded: number;
  /** Average whole days from applying to hearing back; null when there is nothing to average. */
  avgResponseDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeStats(rows: OverviewRow[], now: Date, timeZone: string): JobHuntStats {
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ApplicationStage, number>;
  let saved = 0;
  let savedClosed = 0;
  let applied = 0;
  let longWaits = 0;
  let responded = 0;
  const waits: number[] = [];
  for (const r of rows) {
    if (r.status === 'saved') {
      saved++;
      if (!r.active) savedClosed++;
      continue;
    }
    if (r.status !== 'applied') continue;
    applied++;
    const stage = r.stage ?? 'applied';
    byStage[stage]++;
    if (
      stage === 'applied' &&
      r.stageSince &&
      daysSince(r.stageSince, now, timeZone) >= LONG_WAIT_DAYS
    )
      longWaits++;
    if (r.respondedAt) {
      responded++;
      if (r.appliedAt && r.respondedAt >= r.appliedAt) {
        waits.push((r.respondedAt.getTime() - r.appliedAt.getTime()) / DAY_MS);
      }
    }
  }
  const avgResponseDays =
    waits.length > 0 ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;
  return { saved, savedClosed, applied, byStage, longWaits, responded, avgResponseDays };
}

/** Stage names as they read in a summary ("waiting for a callback", not "applied"). */
const STAGE_LINE: Record<ApplicationStage, string> = {
  applied: '⏳ รอติดต่อกลับ',
  contacted: '📞 ติดต่อกลับแล้ว',
  interview: STAGE_LABEL.interview,
  waiting: '⏳ รอผลสัมภาษณ์',
  offer: STAGE_LABEL.offer,
  rejected: STAGE_LABEL.rejected,
};

export function statsMessage(s: JobHuntStats): OutgoingMessage {
  const buttons = [
    postbackButton('📋 ที่สมัครไว้', { a: 'menu', m: 'applied' }),
    postbackButton('⭐ ที่เก็บไว้', { a: 'menu', m: 'saved' }),
  ];
  if (s.saved === 0 && s.applied === 0) {
    return text(
      '📊 ยังไม่มีข้อมูลให้สรุปครับ\n\n' +
        'เก็บงานจาก 🔍 งานใหม่วันนี้ หรือส่งลิงก์งานจากเว็บไหนก็ได้มาในแชท ' +
        'แล้วกด "✅ สมัครแล้ว" เมื่อสมัคร ระบบจะสรุปความคืบหน้าให้ที่นี่',
      [postbackButton('🔍 งานใหม่วันนี้', { a: 'menu', m: 'feed' })],
    );
  }

  const lines = ['📊 สรุปการหางานของคุณ', ''];
  lines.push(`⭐ เก็บไว้ ${s.saved} งาน` + (s.savedClosed ? ` (ปิดรับแล้ว ${s.savedClosed})` : ''));
  lines.push(`📋 สมัครแล้ว ${s.applied} งาน`);
  for (const stage of STAGES) {
    const n = s.byStage[stage];
    if (!n) continue;
    const extra =
      stage === 'applied' && s.longWaits ? ` (นานกว่า ${LONG_WAIT_DAYS} วัน ${s.longWaits})` : '';
    lines.push(`  • ${STAGE_LINE[stage]} ${n}${extra}`);
  }

  if (s.applied > 0) {
    const pct = Math.round((s.responded / s.applied) * 100);
    lines.push('', `📈 บริษัทติดต่อกลับ ${s.responded} จาก ${s.applied} งาน (${pct}%)`);
    if (s.avgResponseDays !== null) {
      lines.push(
        `⏱️ รอเฉลี่ย ${s.avgResponseDays === 0 ? 'ไม่ถึง 1' : s.avgResponseDays} วันกว่าจะได้รับการติดต่อ`,
      );
    }
  }

  const tips: string[] = [];
  if (s.byStage.offer > 0) tips.push('🎉 ยินดีด้วยกับงานที่ได้ครับ!');
  if (s.longWaits > 0) {
    tips.push(
      `💡 มี ${s.longWaits} งานที่รอนานกว่า ${LONG_WAIT_DAYS} วันแล้ว ลองทักไปถามความคืบหน้า ` +
        'หรือกด "🔄 อัปเดตสถานะ" ถ้าได้คำตอบแล้ว',
    );
  }
  if (s.applied === 0) tips.push('💡 สมัครงานแล้วกด "✅ สมัครแล้ว" ที่การ์ดงาน เพื่อเริ่มนับวันรอ');
  if (s.savedClosed > 0)
    tips.push(`⛔ งานที่เก็บไว้ปิดรับไปแล้ว ${s.savedClosed} งาน ลบออกได้ที่ ⭐`);
  if (tips.length) lines.push('', ...tips);

  return text(lines.join('\n'), buttons);
}
