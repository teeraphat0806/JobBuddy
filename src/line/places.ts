import type { messagingApi } from '@line/bot-sdk';
import type { SessionRepository } from '../conversation/repository.js';
import type { User } from '../db/schema.js';
import type { PlaceRepository } from '../places/repository.js';
import type { OutgoingMessage } from './messenger.js';
import { CANCEL_WORDS } from './tracking.js';
import { postbackButton, sayButton, text } from './ui.js';

export const PLACE_NAME_FLOW = 'place-name';
export const PLACE_WORDS = ['บ้าน', 'ที่พัก', 'ตั้งบ้าน', 'ตั้งที่พัก', 'บ้านของฉัน', 'home'];
export const MAX_PLACES = 5;
const LABEL_MAX = 20;
const FLOW_TTL_MS = 10 * 60 * 1000;
const SUGGESTED = ['🏠 บ้าน', '🏢 คอนโด', '🏫 หอพัก', '👪 บ้านพ่อแม่'];
const ATTRIBUTION = 'ตำแหน่งงานจาก © OpenStreetMap contributors';

/** Quick reply that opens LINE's "share location" screen. */
export const locationButton = (label = '📍 ส่งตำแหน่ง'): messagingApi.QuickReplyItem => ({
  type: 'action',
  action: { type: 'location', label },
});

export function asPlaceNameFlow(state: unknown): { placeId: string } | null {
  return state &&
    typeof state === 'object' &&
    typeof (state as { placeId?: unknown }).placeId === 'string'
    ? (state as { placeId: string })
    : null;
}

export interface PlaceFlowDeps {
  places: PlaceRepository;
  sessions: SessionRepository;
  /** Called after a place is added, e.g. to look up the user's job locations in the background. */
  onPlacesChanged?: (user: User) => void;
}

const cleanLabel = (raw: string) =>
  [...raw.replace(/^[^\p{L}\p{N}]+/u, '').trim()].slice(0, LABEL_MAX).join('').trim();

export function createPlaceFlows(deps: PlaceFlowDeps) {
  const { places, sessions } = deps;

  /** "บ้าน": the user's places, with buttons to add or remove one. */
  async function show(user: User): Promise<OutgoingMessage[]> {
    const list = await places.list(user.id);
    const buttons: messagingApi.QuickReplyItem[] = [];
    if (list.length < MAX_PLACES)
      buttons.push(locationButton(list.length ? '📍 เพิ่มที่พัก' : '📍 ส่งตำแหน่งบ้าน'));
    for (const p of list) {
      buttons.push(postbackButton(`🗑️ ลบ ${p.label}`, { a: 'place', v: 'del', i: p.id }));
    }
    if (list.length === 0) {
      return [
        text(
          '🏠 ตั้งที่พักเพื่อดูระยะทางไปที่ทำงาน\n\n' +
            'กด "📍 ส่งตำแหน่งบ้าน" แล้วเลือกตำแหน่งบนแผนที่ ' +
            `ตั้งได้สูงสุด ${MAX_PLACES} ที่ (เช่น บ้าน และ คอนโด)\n\n` +
            '🔒 เก็บพิกัดไว้คำนวณระยะทางในแชทนี้เท่านั้น ไม่ส่งให้ใคร ลบได้ทุกเมื่อ',
          buttons,
        ),
      ];
    }
    const lines = [`🏠 ที่พักของคุณ (${list.length}/${MAX_PLACES})`];
    for (const p of list) lines.push(`• ${p.label}`);
    lines.push(
      '',
      '📏 ระยะทางเป็นเส้นตรงโดยประมาณ จากเขต/อำเภอที่ประกาศงานระบุ',
      'กด 🗺️ เส้นทาง ที่รายละเอียดงานเพื่อดูเส้นทางจริงใน Google Maps',
      ATTRIBUTION,
    );
    return [text(lines.join('\n'), buttons)];
  }

  /** The user shared a location: save it as one of their places. */
  async function addFromLocation(user: User, lat: number, lng: number): Promise<OutgoingMessage[]> {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return [text('ตำแหน่งนี้ใช้ไม่ได้ครับ ลองส่งใหม่อีกครั้ง')];
    }
    const list = await places.list(user.id);
    if (list.length >= MAX_PLACES) {
      return [
        text(`ตั้งที่พักได้สูงสุด ${MAX_PLACES} ที่ครับ ลบที่เก่าก่อนแล้วส่งใหม่ได้เลย`, [
          sayButton('🏠 ดูที่พัก', 'บ้าน'),
        ]),
      ];
    }
    const label = list.length === 0 ? 'บ้าน' : `ที่พัก ${list.length + 1}`;
    const place = await places.add(user.id, label, lat, lng);
    deps.onPlacesChanged?.(user);
    return [
      text(
        `📍 บันทึกเป็น "${label}" แล้วครับ\nจากนี้การ์ดงานจะบอกระยะทางจากที่นี่ด้วย\n\nตั้งชื่อที่นี่ว่าอะไรดี?`,
        [
          ...SUGGESTED.map((s) =>
            postbackButton(s, { a: 'place', v: 'name', i: place.id, l: cleanLabel(s) }),
          ),
          postbackButton('✏️ พิมพ์ชื่อเอง', { a: 'place', v: 'ask', i: place.id }),
        ],
      ),
    ];
  }

  async function rename(user: User, placeId: string, raw: string): Promise<OutgoingMessage[]> {
    await sessions.clear(user.id);
    if (CANCEL_WORDS.includes(raw.trim().toLowerCase()))
      return [text('โอเคครับ ไม่ได้เปลี่ยนชื่อ')];
    const label = cleanLabel(raw);
    if (!label) return [text('ชื่อว่างอยู่ครับ ไม่ได้เปลี่ยนนะ')];
    if (!(await places.rename(user.id, placeId, label))) return [text('ไม่พบที่พักนี้แล้วครับ')];
    return [text(`✅ ตั้งชื่อเป็น "${label}" แล้วครับ`, [sayButton('🏠 ดูที่พัก', 'บ้าน')])];
  }

  async function askName(user: User, placeId: string): Promise<OutgoingMessage[]> {
    await sessions.set(user.id, PLACE_NAME_FLOW, { placeId }, FLOW_TTL_MS);
    return [
      text(`พิมพ์ชื่อที่พักได้เลยครับ (ไม่เกิน ${LABEL_MAX} ตัวอักษร) เช่น คอนโดอโศก`, [
        sayButton('ยกเลิก'),
      ]),
    ];
  }

  async function remove(user: User, placeId: string): Promise<OutgoingMessage[]> {
    const ok = await places.remove(user.id, placeId);
    return [
      text(ok ? '🗑️ ลบที่พักแล้วครับ' : 'ไม่พบที่พักนี้แล้วครับ', [
        sayButton('🏠 ดูที่พัก', 'บ้าน'),
      ]),
    ];
  }

  return { show, addFromLocation, rename, askName, remove };
}
