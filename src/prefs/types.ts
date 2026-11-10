export const WORK_MODES = ['any', 'onsite', 'hybrid', 'remote'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  any: 'ไม่จำกัด',
  onsite: 'เข้าออฟฟิศ',
  hybrid: 'Hybrid',
  remote: 'Remote / ทำจากบ้าน',
};

export interface PrefsInput {
  positions: string[];
  /** Empty = anywhere in Thailand. */
  locations: string[];
  workMode: WorkMode;
  /** Monthly THB; null = not specified. */
  minSalary: number | null;
  excludedKeywords: string[];
}
