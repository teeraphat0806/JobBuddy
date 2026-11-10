import { describe, expect, it, vi } from 'vitest';
import { decodePostback } from '../src/line/postback.js';
import {
  MENU_ITEMS,
  RICH_MENU_NAME,
  RICH_MENU_SIZE,
  richMenuRequest,
  syncRichMenu,
  type RichMenuApi,
} from '../src/line/richmenu.js';
import { silentLogger } from './helpers.js';

describe('richMenuRequest', () => {
  const req = richMenuRequest();
  const areas = req.areas ?? [];
  const bounds = areas.map((a) => a.bounds as Required<NonNullable<typeof a.bounds>>);

  it('tiles the whole menu with no gaps or overlaps', () => {
    const area = bounds.reduce((sum, b) => sum + b.width * b.height, 0);
    expect(area).toBe(RICH_MENU_SIZE.width * RICH_MENU_SIZE.height);
    for (const b of bounds) {
      expect(b.x + b.width).toBeLessThanOrEqual(RICH_MENU_SIZE.width);
      expect(b.y + b.height).toBeLessThanOrEqual(RICH_MENU_SIZE.height);
    }
  });

  it('sends a menu postback for every item, with labels within LINE limits', () => {
    expect(areas).toHaveLength(MENU_ITEMS.length);
    areas.forEach((a, i) => {
      const action = a.action as { type: string; data: string; label: string };
      expect(action.type).toBe('postback');
      expect(decodePostback(action.data)).toEqual({ a: 'menu', m: MENU_ITEMS[i]!.key });
      expect([...action.label].length).toBeLessThanOrEqual(20);
    });
    expect([...(req.chatBarText ?? '')].length).toBeLessThanOrEqual(14);
  });
});

function fakeApi(existing: { richMenuId: string; name: string }[]) {
  return {
    list: vi.fn(async () => existing),
    create: vi.fn(async () => 'new-id'),
    uploadImage: vi.fn(async () => {}),
    setDefault: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  } satisfies RichMenuApi;
}

const image = async () => new Blob(['png'], { type: 'image/png' });

describe('syncRichMenu', () => {
  it('creates, uploads and sets default when the current version is missing, removing old ones', async () => {
    const api = fakeApi([
      { richMenuId: 'old', name: 'jobbuddy-main-v0' },
      { richMenuId: 'other', name: 'someone-elses-menu' },
    ]);
    await syncRichMenu(api, image, silentLogger);
    expect(api.create).toHaveBeenCalledOnce();
    expect(api.uploadImage).toHaveBeenCalledWith('new-id', expect.any(Blob));
    expect(api.setDefault).toHaveBeenCalledWith('new-id');
    expect(api.remove).toHaveBeenCalledWith('old');
    expect(api.remove).not.toHaveBeenCalledWith('other');
  });

  it('only re-asserts the default when the current version already exists', async () => {
    const api = fakeApi([{ richMenuId: 'cur', name: RICH_MENU_NAME }]);
    await syncRichMenu(api, image, silentLogger);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.setDefault).toHaveBeenCalledWith('cur');
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('removes a half-created menu if the image upload fails', async () => {
    const api = fakeApi([]);
    api.uploadImage.mockRejectedValueOnce(new Error('413'));
    await expect(syncRichMenu(api, image, silentLogger)).rejects.toThrow('413');
    expect(api.remove).toHaveBeenCalledWith('new-id');
    expect(api.setDefault).not.toHaveBeenCalled();
  });
});
