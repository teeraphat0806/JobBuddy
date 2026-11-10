/**
 * Renders assets/richmenu-main.png from the layout in src/line/richmenu.ts.
 * Run after changing MENU_ITEMS:  npm run richmenu:image  (then bump RICH_MENU_NAME).
 * Needs a Thai font installed (Windows: Leelawadee UI) — the PNG is committed, so prod doesn't.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import {
  cellBounds,
  MENU_ITEMS,
  RICH_MENU_IMAGE_PATH,
  RICH_MENU_SIZE,
} from '../src/line/richmenu.js';

const THAI_FONT = "'Leelawadee UI', 'Noto Sans Thai', 'Tahoma', sans-serif";
const EMOJI_FONT = "'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif";

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cells = MENU_ITEMS.map((item, i) => {
  const b = cellBounds(i);
  const cx = b.x + b.width / 2;
  const pad = 18;
  return `
    <rect x="${b.x + pad}" y="${b.y + pad}" width="${b.width - pad * 2}" height="${b.height - pad * 2}"
          rx="56" fill="${item.color}"/>
    <circle cx="${cx}" cy="${b.y + 300}" r="150" fill="#FFFFFF"/>
    <text x="${cx}" y="${b.y + 360}" font-family="${EMOJI_FONT}" font-size="170"
          text-anchor="middle">${esc(item.icon)}</text>
    <text x="${cx}" y="${b.y + 600}" font-family="${THAI_FONT}" font-size="104" font-weight="bold"
          fill="#1F2937" text-anchor="middle">${esc(item.label)}</text>
    <text x="${cx}" y="${b.y + 700}" font-family="${THAI_FONT}" font-size="58"
          fill="#6B7280" text-anchor="middle">${esc(item.hint)}</text>`;
}).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RICH_MENU_SIZE.width}" height="${RICH_MENU_SIZE.height}">
  <rect width="100%" height="100%" fill="#FFFFFF"/>${cells}
</svg>`;

await mkdir(dirname(RICH_MENU_IMAGE_PATH), { recursive: true });
const info = await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toFile(RICH_MENU_IMAGE_PATH);

const kb = Math.round(info.size / 1024);
console.log(`Wrote ${RICH_MENU_IMAGE_PATH} (${info.width}x${info.height}, ${kb} KB)`);
if (info.size > 1024 * 1024) {
  console.error('Rich menu images must be 1 MB or smaller');
  process.exit(1);
}
