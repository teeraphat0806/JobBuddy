import type { Workplace } from './types.js';

const THAILAND =
  /thailand|bangkok|chiang ?mai|phuket|pattaya|chon ?buri|rayong|samut|nonthaburi|pathum ?thani|ayutthaya|khon ?kaen|hat ?yai|songkhla|nakhon|ประเทศไทย|กรุงเทพ/i;

export function isInThailand(location: string): boolean {
  return THAILAND.test(location);
}

/** Best-effort workplace from free-text location, for providers that don't say. */
export function workplaceFromText(location: string): Workplace | null {
  if (/remote/i.test(location)) return 'remote';
  if (/hybrid/i.test(location)) return 'hybrid';
  return null;
}

/** "Bangkok, , Thailand" -> "Bangkok, Thailand" */
export function cleanLocation(location: string): string {
  return location
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

/** Thai place names users type -> English spellings used by job boards. */
const PLACE_ALIASES: Record<string, string[]> = {
  กรุงเทพ: ['bangkok'],
  กรุงเทพฯ: ['bangkok'],
  กรุงเทพมหานคร: ['bangkok'],
  กทม: ['bangkok'],
  'กทม.': ['bangkok'],
  ปริมณฑล: [
    'bangkok',
    'nonthaburi',
    'pathum thani',
    'samut prakan',
    'samut sakhon',
    'nakhon pathom',
  ],
  นนทบุรี: ['nonthaburi'],
  ปทุมธานี: ['pathum thani', 'pathumthani'],
  สมุทรปราการ: ['samut prakan', 'samutprakan'],
  สมุทรสาคร: ['samut sakhon'],
  นครปฐม: ['nakhon pathom'],
  ชลบุรี: ['chonburi', 'chon buri', 'pattaya', 'sriracha', 'si racha', 'laem chabang'],
  พัทยา: ['pattaya'],
  ระยอง: ['rayong'],
  ฉะเชิงเทรา: ['chachoengsao'],
  อยุธยา: ['ayutthaya'],
  พระนครศรีอยุธยา: ['ayutthaya'],
  เชียงใหม่: ['chiang mai', 'chiangmai'],
  เชียงราย: ['chiang rai'],
  ภูเก็ต: ['phuket'],
  ขอนแก่น: ['khon kaen'],
  โคราช: ['nakhon ratchasima', 'korat'],
  นครราชสีมา: ['nakhon ratchasima', 'korat'],
  หาดใหญ่: ['hat yai'],
  สงขลา: ['songkhla', 'hat yai'],
  สุราษฎร์ธานี: ['surat thani', 'samui'],
};

/** Lower-case search terms for a place the user typed (Thai or English). */
export function placeTerms(place: string): string[] {
  const key = place.trim();
  const aliases = PLACE_ALIASES[key] ?? PLACE_ALIASES[key.replace(/ฯ$/, '')] ?? [];
  return [key.toLowerCase(), ...aliases];
}

/** True if the job only says the country (e.g. "Thailand"), with no city. */
export function isCountryOnly(location: string): boolean {
  return /^\s*(thailand|ประเทศไทย)\s*$/i.test(location);
}
