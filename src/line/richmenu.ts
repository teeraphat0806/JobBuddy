import { readFile } from 'node:fs/promises';
import { messagingApi } from '@line/bot-sdk';
import { errorFields, type Logger } from '../lib/logger.js';
import { encodePostback } from './postback.js';

/** Bump when the layout or image changes; startup sync replaces older versions. */
export const RICH_MENU_NAME = 'jobbuddy-main-v1';
const NAME_PREFIX = 'jobbuddy-main-';

export const RICH_MENU_SIZE = { width: 2500, height: 1686 } as const;
export const RICH_MENU_IMAGE_PATH = 'assets/richmenu-main.png';

export interface MenuItem {
  key: 'feed' | 'saved' | 'applied' | 'interviews' | 'prefs' | 'help';
  icon: string;
  label: string;
  hint: string;
  color: string;
}

/** Row-major, 3 columns x 2 rows. */
export const MENU_ITEMS: MenuItem[] = [
  { key: 'feed', icon: '🔍', label: 'งานใหม่วันนี้', hint: 'งานที่ตรงกับคุณ', color: '#E8F8EE' },
  { key: 'saved', icon: '⭐', label: 'ที่เก็บไว้', hint: 'งานที่สนใจ', color: '#FFF6DD' },
  { key: 'applied', icon: '📋', label: 'ที่สมัครไว้', hint: 'ติดตามสถานะ', color: '#E7F1FD' },
  { key: 'interviews', icon: '📅', label: 'นัดสัมภาษณ์', hint: 'นัดและการเตือน', color: '#FDECEC' },
  { key: 'prefs', icon: '⚙️', label: 'ตั้งค่างาน', hint: 'ตำแหน่งที่อยากได้', color: '#F0ECFB' },
  { key: 'help', icon: '❓', label: 'วิธีใช้', hint: 'ดูคำสั่งทั้งหมด', color: '#EEF0F2' },
];

export function cellBounds(index: number) {
  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x = Math.round((RICH_MENU_SIZE.width * col) / cols);
  const nextX = Math.round((RICH_MENU_SIZE.width * (col + 1)) / cols);
  const height = RICH_MENU_SIZE.height / 2;
  return { x, y: row * height, width: nextX - x, height };
}

export function richMenuRequest(): messagingApi.RichMenuRequest {
  return {
    size: RICH_MENU_SIZE,
    selected: true,
    name: RICH_MENU_NAME,
    chatBarText: 'เมนู JobBuddy',
    areas: MENU_ITEMS.map((item, i) => ({
      bounds: cellBounds(i),
      action: {
        type: 'postback',
        label: item.label,
        data: encodePostback({ a: 'menu', m: item.key }),
        displayText: `${item.icon} ${item.label}`,
      },
    })),
  };
}

export interface RichMenuApi {
  list(): Promise<{ richMenuId: string; name: string }[]>;
  create(req: messagingApi.RichMenuRequest): Promise<string>;
  uploadImage(richMenuId: string, png: Blob): Promise<void>;
  setDefault(richMenuId: string): Promise<void>;
  remove(richMenuId: string): Promise<void>;
}

export function createRichMenuApi(channelAccessToken: string): RichMenuApi {
  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken });
  return {
    list: async () => (await client.getRichMenuList()).richmenus,
    create: async (req) => (await client.createRichMenu(req)).richMenuId,
    uploadImage: async (id, png) => void (await blob.setRichMenuImage(id, png)),
    setDefault: async (id) => void (await client.setDefaultRichMenu(id)),
    remove: async (id) => void (await client.deleteRichMenu(id)),
  };
}

/**
 * Idempotent: make sure the current menu version exists, has its image and is the default,
 * then delete older JobBuddy menus. Safe to run on every startup.
 */
export async function syncRichMenu(
  api: RichMenuApi,
  loadImage: () => Promise<Blob>,
  logger: Logger,
): Promise<void> {
  const menus = await api.list();
  let current = menus.find((m) => m.name === RICH_MENU_NAME)?.richMenuId;

  if (!current) {
    current = await api.create(richMenuRequest());
    try {
      await api.uploadImage(current, await loadImage());
    } catch (err) {
      // A menu without an image can't be set as default; don't leave it behind.
      await api.remove(current).catch(() => {});
      throw err;
    }
    logger.info('Rich menu created', { richMenuId: current, name: RICH_MENU_NAME });
  }

  await api.setDefault(current);

  for (const old of menus) {
    if (old.name.startsWith(NAME_PREFIX) && old.richMenuId !== current) {
      await api.remove(old.richMenuId).catch((err: unknown) => {
        logger.warn('Failed to delete old rich menu', {
          richMenuId: old.richMenuId,
          ...errorFields(err),
        });
      });
    }
  }
}

export async function loadRichMenuImage(path = RICH_MENU_IMAGE_PATH): Promise<Blob> {
  return new Blob([await readFile(path)], { type: 'image/png' });
}
