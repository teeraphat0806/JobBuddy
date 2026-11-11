import { daysUntil } from '../interviews/time.js';
import type { ApplicationStage } from '../jobs/repository.js';

/** In the order an application usually moves through. */
export const STAGES: readonly ApplicationStage[] = [
  'applied',
  'contacted',
  'interview',
  'waiting',
  'offer',
  'rejected',
];

/** Short names, used on buttons. */
export const STAGE_LABEL: Record<ApplicationStage, string> = {
  applied: '✅ สมัครแล้ว',
  contacted: '📞 ได้รับการติดต่อ',
  interview: '📅 นัดสัมภาษณ์',
  waiting: '⏳ รอผล',
  offer: '🎉 ได้งาน',
  rejected: '🙏 ไม่ผ่าน',
};

/** What the user is waiting for at each stage; offer / rejected are final, so no clock. */
const WAITING_FOR: Partial<Record<ApplicationStage, string>> = {
  applied: '⏳ รอติดต่อกลับ',
  contacted: '📞 ติดต่อกลับแล้ว',
  interview: '📅 นัดสัมภาษณ์',
  waiting: '⏳ รอผล',
};

export const isStage = (v: string | undefined): v is ApplicationStage =>
  STAGES.includes(v as ApplicationStage);

/** Whole calendar days since `since` in the user's time zone (0 = today). */
export function daysSince(since: Date, now: Date, timeZone: string): number {
  return Math.max(0, -daysUntil(since, now, timeZone));
}

/**
 * The stage with how long it has lasted, e.g. "⏳ รอติดต่อกลับ · 5 วัน". The count restarts
 * whenever the stage changes.
 */
export function stageStatus(
  stage: ApplicationStage,
  since: Date | null,
  now: Date,
  timeZone: string,
): string {
  const label = WAITING_FOR[stage];
  if (!label) return STAGE_LABEL[stage];
  if (!since) return label;
  const days = daysSince(since, now, timeZone);
  return `${label} · ${days === 0 ? 'วันนี้' : `${days} วัน`}`;
}
