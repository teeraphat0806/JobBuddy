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

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  applied: '✅ สมัครแล้ว',
  contacted: '📞 ได้รับการติดต่อ',
  interview: '📅 นัดสัมภาษณ์',
  waiting: '⏳ รอผล',
  offer: '🎉 ได้งาน',
  rejected: '🙏 ไม่ผ่าน',
};

export const isStage = (v: string | undefined): v is ApplicationStage =>
  STAGES.includes(v as ApplicationStage);
